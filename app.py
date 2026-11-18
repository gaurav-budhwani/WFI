#!/usr/bin/env python3
import http.server
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def find_available_port(start_port=8000, max_tries=50):
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port

def run_server():
    base_dir = Path(__file__).resolve().parent / "web"
    if not base_dir.exists():
        base_dir = Path(__file__).resolve().parent

    port = find_available_port(8000)
    lan_ip = get_lan_ip()

    class CustomHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(base_dir), **kwargs)

        def log_message(self, format, *args):
            # Keep console output clean
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), CustomHandler) as httpd:
        local_url = f"http://localhost:{port}"
        lan_url = f"http://{lan_ip}:{port}"

        print("--------------------------------------------------")
        print("Whiteboard Web Application")
        print("--------------------------------------------------")
        print(f"Local access:   {local_url}")
        print(f"iPad on Wi-Fi:  {lan_url}")
        print("--------------------------------------------------")
        print("Press Ctrl+C to stop the server.")

        def open_browser():
            time.sleep(0.6)
            webbrowser.open(local_url)

        threading.Thread(target=open_browser, daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()
            sys.exit(0)

if __name__ == "__main__":
    run_server()
