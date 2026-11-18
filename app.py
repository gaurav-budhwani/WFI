#!/usr/bin/env python3
import http.server
import json
import os
import queue
import re
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path

# In-memory room message hubs for local Wi-Fi real-time live sync
ROOM_SUBSCRIBERS = {}
ROOM_STATES = {}
ROOM_LOCK = threading.Lock()

def get_bonjour_hostname():
    try:
        out = subprocess.check_output(["scutil", "--get", "LocalHostName"], text=True).strip()
        if out:
            return f"{out}.local"
    except Exception:
        pass
    try:
        host = socket.gethostname()
        if not host.endswith(".local"):
            return f"{host}.local"
        return host
    except Exception:
        return ""

def get_physical_wifi_ip():
    """Detect the real physical Wi-Fi or Ethernet IPv4 address, strictly ignoring virtual bridges and tunnels."""
    ignored_prefixes = ("bridge", "vmnet", "vmenet", "vbox", "utun", "docker", "p2p", "awdl", "llw", "lo")
    iface_ips = {}

    try:
        out = subprocess.check_output(["ifconfig"], text=True, stderr=subprocess.DEVNULL)
        current_iface = None
        for line in out.splitlines():
            if line and not line.startswith("\t") and not line.startswith(" "):
                current_iface = line.split(":")[0]
                iface_ips[current_iface] = []
            elif current_iface and "inet " in line:
                parts = line.strip().split()
                if len(parts) >= 2:
                    ip = parts[1]
                    if not ip.startswith("127.") and not ip.startswith("169.254."):
                        iface_ips[current_iface].append(ip)

        # 1. Prioritize en0 (standard primary Wi-Fi interface on macOS)
        if "en0" in iface_ips and iface_ips["en0"]:
            return iface_ips["en0"][0]

        # 2. Check other non-virtual physical interfaces
        for iface, ips in iface_ips.items():
            if not any(iface.startswith(prefix) for prefix in ignored_prefixes):
                if ips:
                    return ips[0]
    except Exception:
        pass

    # 3. Fallback: Hostname address lookup
    try:
        host = socket.gethostname()
        for info in socket.getaddrinfo(host, None):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("192.168.2.") and ":" not in ip:
                return ip
    except Exception:
        pass

    # 4. Fallback: Socket route probe
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    return "127.0.0.1"

def find_available_port(start_port=8000, max_tries=50):
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("0.0.0.0", port)) != 0:
                return port
    return start_port

class WhiteboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        base_dir = Path(__file__).resolve().parent / "web"
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent
        super().__init__(*args, directory=str(base_dir), **kwargs)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # API: Return accurate physical Wi-Fi IP and Bonjour hostname
        if path == "/api/network-info":
            wifi_ip = get_physical_wifi_ip()
            bonjour = get_bonjour_hostname()
            port = self.server.server_address[1]
            data = {
                "port": port,
                "primary_ip": wifi_ip,
                "ipad_url": f"http://{wifi_ip}:{port}",
                "bonjour_url": f"http://{bonjour}:{port}" if bonjour else ""
            }
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # API: Retrieve current room state snapshot
        if path == "/api/room/state":
            room_id = (query.get("room", ["DEFAULT"])[0]).upper()
            with ROOM_LOCK:
                state = ROOM_STATES.get(room_id, {})
            body = json.dumps(state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # API: Server-Sent Events (SSE) live streaming for local Wi-Fi sync
        if path == "/api/room/stream":
            room_id = (query.get("room", ["DEFAULT"])[0]).upper()
            client_queue = queue.Queue()

            with ROOM_LOCK:
                if room_id not in ROOM_SUBSCRIBERS:
                    ROOM_SUBSCRIBERS[room_id] = []
                ROOM_SUBSCRIBERS[room_id].append(client_queue)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            try:
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
            except Exception:
                with ROOM_LOCK:
                    if room_id in ROOM_SUBSCRIBERS and client_queue in ROOM_SUBSCRIBERS[room_id]:
                        ROOM_SUBSCRIBERS[room_id].remove(client_queue)
                return

            try:
                while True:
                    try:
                        msg = client_queue.get(timeout=15.0)
                        payload = f"data: {json.dumps(msg)}\n\n".encode("utf-8")
                        self.wfile.write(payload)
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
            except Exception:
                pass
            finally:
                with ROOM_LOCK:
                    if room_id in ROOM_SUBSCRIBERS and client_queue in ROOM_SUBSCRIBERS[room_id]:
                        ROOM_SUBSCRIBERS[room_id].remove(client_queue)
            return

        # Static file delivery
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # API: Broadcast real-time event to all subscribers in room
        if path == "/api/room/broadcast":
            room_id = (query.get("room", ["DEFAULT"])[0]).upper()
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)

            try:
                data = json.loads(raw_body.decode("utf-8"))
            except Exception:
                self.send_response(400)
                self.end_headers()
                return

            if data.get("type") == "full_state":
                with ROOM_LOCK:
                    ROOM_STATES[room_id] = data.get("state", {})

            with ROOM_LOCK:
                subscribers = list(ROOM_SUBSCRIBERS.get(room_id, []))

            for q in subscribers:
                try:
                    q.put_nowait(data)
                except Exception:
                    pass

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

def run_server():
    port = find_available_port(8000)
    wifi_ip = get_physical_wifi_ip()
    bonjour = get_bonjour_hostname()

    local_url = f"http://localhost:{port}"
    wifi_url = f"http://{wifi_ip}:{port}"
    bonjour_url = f"http://{bonjour}:{port}" if bonjour else ""

    server = ThreadingTCPServer(("0.0.0.0", port), WhiteboardHandler)

    print("==================================================")
    print("Whiteboard Web Server Running")
    print("==================================================")
    print(f"Mac Browser:   {local_url}")
    print(f"iPad on Wi-Fi: {wifi_url}")
    if bonjour_url:
        print(f"Apple Bonjour: {bonjour_url}")
    print("--------------------------------------------------")
    print("Important instructions for iPad:")
    print(f"1. Open Safari on your iPad and go to: {wifi_url}")
    print(f"   (Always remember to include :{port} at the end)")
    print("2. Or scan the QR code in the Share dialog on your Mac screen.")
    print("==================================================")
    print("Opening browser on Mac...")
    print("Press Ctrl+C to stop the server.")

    def open_browser():
        time.sleep(0.5)
        webbrowser.open(local_url)

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()
        sys.exit(0)

if __name__ == "__main__":
    run_server()
