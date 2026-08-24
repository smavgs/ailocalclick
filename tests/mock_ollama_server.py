#!/usr/bin/env python3
"""Local-only Ollama API fixture for browser integration checks.

This server accepts only the gemma4 test slug and never contacts Ollama.
"""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 11435
ALLOWED_ORIGINS = {"http://127.0.0.1:4321", "http://localhost:4321"}


class MockOllamaHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/api/version":
            self._json(404, {"error": "not found"})
            return
        self._json(200, {"version": "0.99.0-browser-test"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/pull":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "invalid request"})
            return
        if payload != {"model": "gemma4", "stream": True}:
            self._json(400, {"error": "fixture accepts only the gemma4 stream test"})
            return

        updates = [
            {"status": "pulling manifest"},
            {"status": "pulling test-layer", "digest": "sha256:test", "total": 1000, "completed": 250},
            {"status": "pulling test-layer", "digest": "sha256:test", "total": 1000, "completed": 750},
            {"status": "pulling test-layer", "digest": "sha256:test", "total": 1000, "completed": 1000},
            {"status": "verifying sha256 digest"},
            {"status": "writing manifest"},
            {"status": "success"},
        ]
        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Connection", "close")
        self.end_headers()
        for update in updates:
            self.wfile.write(json.dumps(update).encode() + b"\n")
            self.wfile.flush()
            time.sleep(0.06)
        self.close_connection = True

    def log_message(self, format: str, *args: object) -> None:
        print(f"mock-ollama: {format % args}")


if __name__ == "__main__":
    print(f"Mock Ollama API listening on http://{HOST}:{PORT}")
    try:
        ThreadingHTTPServer((HOST, PORT), MockOllamaHandler).serve_forever()
    except KeyboardInterrupt:
        print("Mock Ollama API stopped")
