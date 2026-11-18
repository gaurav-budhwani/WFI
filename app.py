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
# room_id -> list of Queue objects (one for each connected SSE client)
ROOM_SUBSCRIBERS = {}
ROOM_STATES = {}
ROOM_LOCK = threading.Lock()

def get_all_lan_ips():
    """Detect all active local network IPv4 addresses (Wi-Fi, Ethernet) on macOS/Linux/Windows."""
    candidates = []

    # 1. On macOS / Unix, inspect ifconfig output for active interfaces
    try:
        out = subprocess.check_output(["ifconfig"], text=True, stderr=subprocess.DEVNULL)
        current_iface = None
        iface_ips = {}
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

        # Prioritize en0 (primary Wi-Fi on macOS)
        if "en0" in iface_ips and iface_ips["en0"]:
            for ip in iface_ips["en0"]:
                if ip not in candidates:
                    candidates.append(ip)

        # Other standard interfaces (en1, en2, eth0, wlan0)
        for iface, ips in iface_ips.items():
            if iface not in ("en0", "bridge100", "bridge0", "lo0"):
                for ip in ips:
                    if ip not in candidates:
                        candidates.append(ip)

        # Virtual bridges as fallback
        for iface, ips in iface_ips.items():
            for ip in ips:
                if ip not in candidates:
                    candidates.append(ip)
    except Exception:
        pass

    # 2. Hostname resolution fallback
    try:
        host = socket.gethostname()
        for info in socket.getaddrinfo(host, None):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ":" not in ip and ip not in candidates:
                candidates.append(ip)
    except Exception:
        pass

    # 3. UDP socket route probe fallback
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127.") and ip not in candidates:
            candidates.insert(0, ip)
    except Exception:
        pass

    if not candidates:
        candidates.append("127.0.0.1")

    return candidates

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
        # Keep terminal output quiet and clean
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # API: Return detected network IP addresses
        if path == "/api/network-info":
            lan_ips = get_all_lan_ips()
            port = self.server.server_address[1]
            data = {
                "port": port,
                "primary_ip": lan_ips[0] if lan_ips else "127.0.0.1",
                "all_ips": lan_ips,
                "ipad_url": f"http://{lan_ips[0]}:{port}"
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

            # Send initial keep-alive ping
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
                        # Periodic keep-alive ping
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

            # If message is full board state, cache it
            if data.get("type") == "full_state":
                with ROOM_LOCK:
                    ROOM_STATES[room_id] = data.get("state", {})

            # Push to all active subscriber queues for this room
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
    lan_ips = get_all_lan_ips()
    primary_ip = lan_ips[0]

    local_url = f"http://localhost:{port}"
    wifi_url = f"http://{primary_ip}:{port}"

    server = ThreadingTCPServer(("0.0.0.0", port), WhiteboardHandler)

    print("--------------------------------------------------")
    print("Whiteboard Web Application")
    print("--------------------------------------------------")
    print(f"Local Mac URL:  {local_url}")
    print(f"iPad on Wi-Fi:  {wifi_url}")
    if len(lan_ips) > 1:
        print(f"Alternative IP: http://{lan_ips[1]}:{port}")
    print("--------------------------------------------------")
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
