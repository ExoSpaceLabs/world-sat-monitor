from __future__ import annotations

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit


ExtraGetHandler = Callable[[str, dict[str, list[str]]], tuple[int, Any] | None]


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


def start_health_server(
    port: int,
    health: WorkerHealth,
    extra_get: ExtraGetHandler | None = None,
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status_code: int, payload: Any) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urlsplit(self.path)
            if parsed.path == "/health":
                self._json(200, health.snapshot())
                return
            if extra_get is not None:
                result = extra_get(parsed.path, parse_qs(parsed.query))
                if result is not None:
                    self._json(*result)
                    return
            self._json(404, {"detail": "not found"})

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server
