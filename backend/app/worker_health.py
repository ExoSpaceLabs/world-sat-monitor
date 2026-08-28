from __future__ import annotations

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
from typing import Any


class WorkerHealth:
    def __init__(self, service: str):
        self.state: dict[str, Any] = {
            "service": service,
            "status": "starting",
            "last_cycle_at": None,
            "last_success_at": None,
            "last_error": None,
        }

    def success(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.state.update(
            status="ok",
            last_cycle_at=now,
            last_success_at=now,
            last_error=None,
        )

    def failure(self, error: Exception | str) -> None:
        self.state.update(
            status="degraded",
            last_cycle_at=datetime.now(timezone.utc).isoformat(),
            last_error=str(error),
        )

    def snapshot(self) -> dict[str, Any]:
        return dict(self.state)


def start_health_server(port: int, health: WorkerHealth) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps(health.snapshot(), separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server
