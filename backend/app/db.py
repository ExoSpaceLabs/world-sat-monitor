from __future__ import annotations

import time

import psycopg
from psycopg.rows import dict_row

from .config import settings


def connect():
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def wait_for_database(attempts: int = 30, delay_seconds: float = 1.0) -> None:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            with connect() as connection:
                connection.execute("SELECT 1")
            return
        except psycopg.Error as error:
            last_error = error
            time.sleep(delay_seconds)
    raise RuntimeError("database did not become ready") from last_error
