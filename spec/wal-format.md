# WAL format v1

File magic `SEAW` then version u16=1, page_size u32=16384, reserved.

Record:

```
0   u32 magic 0x314C4157
4   u32 payload_length (max 1 MiB)
8   u8  type
9   u8  flags
10  u64 lsn
18  u64 prev_lsn
26  u64 xid
34  u32 crc32 of bytes 0..33 plus payload with crc field zero
38  payload
```

Types: 1 BEGIN 2 HEAP_PUT 3 HEAP_XMAX 4 PAGE_ALLOC 5 CATALOG 6 BTREE_PUT 7 BTREE_DEL 8 COMMIT 9 ABORT 10 CHECKPOINT 11 EVIDENCE_OUTBOX 12 SUPER.

Torn tail: if magic/length/crc fail at EOF, the record is incomplete and discarded. A torn record not at EOF is `E_WAL_CORRUPT` and startup fails closed.

Commit durability point: `COMMIT` record fsynced. Checkpoint payload: redo_lsn, next_xid, next_page, catalog snapshot lsn.
