# Transaction model — seamql/0.1

Single-node. Isolation: **snapshot isolation**, not serializable.

`visible(version, snapshot, own_xid)`:

1. If `xmin == own_xid` and `xmax != own_xid`: visible (own insert). If also `xmax == own_xid`: invisible (own delete).
2. If `xmin` is aborted, in-progress in the snapshot, or not committed: invisible.
3. If `xmin >= snapshot.xmax` or `xmin` ∈ snapshot.active: invisible.
4. If `xmax == 0` or `xmax` aborted or `xmax` in-progress (not own): visible.
5. If `xmax` committed and `xmax < snapshot.xmax` and `xmax` ∉ snapshot.active: invisible.

Unknown clog state is not committed.

Writes: first-writer-wins. If the latest visible version has `xmax` of another active xid, the later writer aborts `E_CONFLICT`.

Autocommit: a statement outside `start tx` begins, runs, and `lock in`s. `dip` undoes the current tx.

Commit protocol: validate deferred constraints → WAL `COMMIT` → `fsync` WAL through that record → publish visibility → success. Failure before fsync is abort. Ambiguous I/O after fsync returns `E_COMMIT_AMBIGUOUS`; clients lookup xid status.

Durability: WAL-before-data. Buffer pool is **no-steal** for uncommitted dirty pages. Recovery redos records with `page.lsn < rec.lsn` from last checkpoint; uncommitted xids abort.

Xids are monotonically allocated on a superblock field, WAL-logged before use.
