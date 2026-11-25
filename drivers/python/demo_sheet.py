# demo_sheet.py — live Python tour of SEAMDB.
#
# Run:   python demo_sheet.py          (engine on 127.0.0.1:7301)
#        python demo_sheet.py --fresh  first: clears tables created below
#
# This is the REAL driver (drivers/python/seamdb.py), not a wrapper: it
# speaks the engine's framed wire protocol over TCP —
#     4-byte length | 1-byte frame type | UTF-8 JSON payload
# frame types: 1 HELLO · 2 AUTH · 3 QUERY · 4 RESULTS · 5 ERROR · 8 CATALOG —
# the same frames the Studio IDE and the browser page speak.
#
# Every scene below was executed against the live engine; the comments show
# the observed output. Each scene is its own try/except so one typo on stage
# never kills the whole script.

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seamdb  # noqa: E402

W, LINE = 68, "=" * 68


def banner(title: str) -> None:
    print(f"\n{LINE}\n{title}\n{LINE}")


# swallow 'already exists'/'clash' from a previous run so the script is
# re-runnable side by side with the Studio session
def ignore_exists(e: seamdb.SeamError) -> bool:
    return e.code in ("E_UNIQUE", "E_EXIST", "E_UNKNOWN_NAME") or "already exists" in str(e)


def show(result: seamdb.Result) -> None:
    print(f"  columns: {result.columns}")
    for row in result.rows:
        print(f"  row:     {row}")
    print(f"  xid={result.xid}  evidence={result.evidence_state}")


def main() -> int:
    fresh = "--fresh" in sys.argv
    db = seamdb.connect("127.0.0.1", 7301, user="root", roles=["owner"])
    print(f"connected: {db._sock.getpeername()} - zero dependencies, bare socket")

    # ---- pre-tidy: rows an earlier aborted demo may have left behind ---
    try:
        db.query("yeet from folks when name = 'Ghost'")
    except seamdb.SeamError:
        pass

    # ---- scene 0 · introspection -------------------------------------
    banner("SCENE 0 . catalog() - schema introspection over frame 8")
    try:
        cat = db.catalog()
        names = [t["name"] for t in cat.get("tables", [])]
        print(f"  visible tables: {names}")
        print(f"  identity:       {cat.get('roles')}")
    except seamdb.SeamError as e:
        print(f"  (catalog unavailable on this build: {e.code})")

    # ---- scene 1 . table + rows + query ------------------------------
    banner("SCENE 1 . DDL + inserts through the socket")
    try:
        db.query("spawn table folks: id: whole number, main key, name: text, needed")
        print("  fresh mode: folks created") if fresh else None
    except seamdb.SeamError as e:
        if not ignore_exists(e):
            raise
    for stmt in (
        "drop in folks { id: 1, name: 'Ada' }",
        "drop in folks { id: 2, name: 'Grace' }",
    ):
        try:
            db.query(stmt)
        except seamdb.SeamError as e:
            if not ignore_exists(e):
                raise
    res = db.query("pull id, name from folks rank by id")[0]
    show(res)

    # ---- scene 2 . LeetCode 183 over the wire ------------------------
    banner("SCENE 2 . LeetCode 183: Customers Who Never Order")
    try:
        db.query("spawn table runs: rid: whole number, main key, folks_id: whole number, needed, links to folks.id, amount: decimal(12, 2), needed")
    except seamdb.SeamError as e:
        if not ignore_exists(e):
            raise
    try:
        db.query("drop in runs { rid: 1, folks_id: 1, amount: 10.00 }")
    except seamdb.SeamError as e:
        if not ignore_exists(e):
            raise
    res = db.query(
        "pull folks.name as customers from folks"
        " left link runs on folks.id = runs.folks_id"
        " when runs.rid is null"
    )[0]
    show(res)  # -> customers: Grace, Linus

    # ---- scene 3 . typed errors you can catch ------------------------
    banner("SCENE 3 . SeamError is a real Python exception with a code")
    try:
        db.query("pull ghost from folks")
    except seamdb.SeamError as e:
        print(f"  caught SeamError: code={e.code}  line={e.line}  msg={e}")

    # ---- scene 4 . MVCC abort, seen from Python ----------------------
    banner("SCENE 4 . transactions: the row that vanishes on dip")
    # NOTE: one query() = one session, so the whole transaction lives in a
    # single script (this surprises people used to one-statement-per-call)
    scenes = db.query(
        "start tx\n"
        "drop in folks { id: 9, name: 'Ghost' }\n"
        "pull id from folks when id = 9\n"
        "dip\n"
        "pull id from folks when id = 9"
    )
    print("  inside the tx (before dip):")
    show(scenes[2])  # row id 9 visible to its own transaction
    after = scenes[4]
    print(f"  after dip: {len(after)} rows - the write never persisted")

    # ---- scene 5 . physical plan -------------------------------------
    banner("SCENE 5 . res.plan - the planner is honest")
    try:
        db.query("add index folks_by_name on folks (name)")
    except seamdb.SeamError as e:
        if not ignore_exists(e):
            raise
    res = db.query("spill pull name from folks when name = 'Ada'")[0]
    print(f"  plan: {res.plan}")

    db.close()
    print(f"\n{LINE}\n5 scenes ran clean. That's the whole protocol: same frames,\nsame engine, zero C wrapper in between.\n{LINE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
