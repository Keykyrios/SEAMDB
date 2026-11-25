# Wire protocol v1 (in-process and TCP-ready)

Frame: `u32be length` (max 4 MiB) + `u8 type` + payload. Types: 1 HELLO 2 AUTH 3 QUERY 4 QUERY_RESULT 5 ERROR 6 CANCEL 7 STATUS.

HELLO payload: `{proto:1, lang:"seamql/0.1", engine:"seamdb-engine/0.1.0"}`. AUTH before QUERY. QUERY: `{id, seamql, timeout_ms, idempotency_key}`. Result: `{id, columns, rows, xid, commit_lsn, evidence_state}`. Errors never include row values.

v0 ships the codec and an in-process loop. TCP bind is implemented for Node but refuses `mode=production` without an authenticated TLS stack (reviewed TLS is out of this crate; the server returns `E_FEATURE_NOT_SUPPORTED` for cleartext bind in production).
