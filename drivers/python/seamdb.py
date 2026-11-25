"""seamdb.py — the Python driver for SEAMDB.

Speaks SEAMDB's native wire protocol (frame-per-message over TCP):
    4 bytes  frame length (payload + 1, big-endian)
    1 byte   frame type (1 HELLO, 2 AUTH, 3 QUERY, 4 RESULTS, 5 ERROR, 7 META)
    N bytes  payload (UTF-8 JSON)

Zero dependencies: just `socket` and `json`. This is *not* a PostgreSQL
wrapper — the server has exactly one protocol and this binds to it directly.

    import seamdb
    db = seamdb.connect(port=7301, user="root", roles=["owner"])
    res = db.query("pull name from customers when region = 'west'")
    for row in res.rows:
        print(row["name"])
    db.close()
"""

from __future__ import annotations

import json
import socket
from typing import Any

PROTO = 1
MAX_FRAME = 4 * 1024 * 1024

HELLO = 1
AUTH = 2
QUERY = 3
RESULTS = 4
ERROR = 5
META = 7
CATALOG = 8


class SeamError(Exception):
    """A SEAMDB error with its machine code, and position when known."""

    def __init__(self, code: str, message: str, line: int | None = None,
                 column: int | None = None, hint: str | None = None,
                 cause: Exception | None = None):
        super().__init__(message if cause is None else f"{message} ({cause})")
        self.code = code
        self.line = line
        self.column = column
        self.hint = hint


class Result:
    """One statement's output: column names plus rows as dicts (and tuples)."""

    def __init__(self, columns: list[str], display_rows: list[list[str | None]],
                 xid: str, commit_lsn: str | None, evidence_state: str,
                 plan: Any):
        self.columns = columns
        self.xid = xid
        self.commit_lsn = commit_lsn
        self.evidence_state = evidence_state
        self.plan = plan
        self._rows = [[_decode_cell(c) for c in r] for r in display_rows]

    def __len__(self) -> int:
        return len(self._rows)

    @property
    def rows(self) -> list[dict[str, str | None]]:
        return [dict(zip(self.columns, r)) for r in self._rows]

    def __iter__(self):
        return iter(self.rows)

    def __repr__(self) -> str:
        return f"Result(columns={self.columns!r}, rows={len(self._rows)})"


class Connection:
    def __init__(self, host: str, port: int, user: str, roles: list[str],
                 timeout: float = 30.0):
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._buf = b""
        self._next_id = 0

        hello = self._exchange(HELLO, {})
        if hello.get("proto") != PROTO:
            raise SeamError("E_PROTO",
                            f"server protocol {hello.get('proto')} != driver {PROTO}")
        self._exchange(AUTH, {"user": user, "roles": roles})

    # ---- public API ----

    def query(self, seamql: str, *, timeout_ms: int | None = None,
              idempotency_key: str | None = None) -> list[Result]:
        """Run every statement in `seamql`; one Result per statement."""
        self._next_id += 1
        qid = f"p{self._next_id}"
        body: dict[str, Any] = {"id": qid, "seamql": seamql,
                                "timeout_ms": timeout_ms or 30000}
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        out = self._exchange(QUERY, body)
        if out.get("duplicate"):
            return []
        results: list[Result] = []
        for r in out.get("results", []):
            results.append(Result(
                columns=r["columns"],
                display_rows=r["rows"],
                xid=r["xid"],
                commit_lsn=r.get("commit_lsn"),
                evidence_state=r.get("evidence_state", "none"),
                plan=r.get("plan"),
            ))
        return results

    def catalog(self) -> dict[str, Any]:
        """Schema introspection (frame 8): visible tables, views, identity."""
        return self._exchange(CATALOG, {})

    def close(self) -> None:
        try:
            self._sock.close()
        except OSError:
            pass

    def __enter__(self) -> Connection:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ---- internals ----

    def _exchange(self, ftype: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._send(ftype, payload)
        ftype2, data = self._recv_frame()
        if ftype2 == ERROR:
            e = json.loads(data.decode("utf-8"))
            raise SeamError(e.get("code", "E_CORRUPT"), e.get("message", "error"),
                            line=e.get("line"), column=e.get("column"),
                            hint=e.get("hint"))
        return json.loads(data.decode("utf-8"))

    def _send(self, ftype: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        if len(body) + 1 > MAX_FRAME:
            raise SeamError("E_LIMIT", f"frame payload exceeds {MAX_FRAME} bytes")
        frame = (len(body) + 1).to_bytes(4, "big") + bytes([ftype]) + body
        self._sock.sendall(frame)

    def _recv_frame(self) -> tuple[int, bytes]:
        while len(self._buf) < 4:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise SeamError("E_CONN_CLOSED", "server closed the connection")
            self._buf += chunk
        n = int.from_bytes(self._buf[:4], "big")
        if n < 1 or n > MAX_FRAME:
            raise SeamError("E_LIMIT", f"frame length {n} out of range")
        while len(self._buf) < 4 + n:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise SeamError("E_CONN_CLOSED", "server closed the connection")
            self._buf += chunk
        frame, self._buf = self._buf[4:4 + n], self._buf[4 + n:]
        return frame[0], frame[1:]


def _decode_cell(s: str | None) -> str | None:
    """The wire carries display text; JSON-quoted strings decode to raw text."""
    if s is None or s == "null":
        return None
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        try:
            return json.loads(s)
        except ValueError:
            return s
    return s


def connect(host: str = "127.0.0.1", port: int = 7301, user: str = "root",
            roles: list[str] | None = None, timeout: float = 30.0) -> Connection:
    return Connection(host, port, user, roles or [], timeout)
