# Page format v1

Little-endian. Page size **16384**. Checksum: CRC-32 (ISO 3309) of the page with bytes 48–51 zeroed.

```
offset  size  field
0       4     magic 'SEMP'
4       2     format version = 1
6       2     page type: 1 super 2 heap 3 btree_internal 4 btree_leaf 5 catalog 6 free
8       8     page_id
16      8     object_id
24      8     generation (increments on reuse)
32      8     lsn
40      2     slot_count
42      2     lower (first byte after line pointers)
44      2     upper (first byte of tuple area)
46      2     flags
48      4     crc32
52      12    reserved zero (or AES nonce when encrypted-at-rest wraps the page)
```

Line pointers at offset 64: `{offset:u16, length:u16}` × slot_count. Tuples grow from the end. Overlap, `offset+length > 16384`, `lower > upper`, non-zero reserved (unencrypted), bad magic/version/type, or bad CRC → reject, never cache as data.

## Tuple v1

```
0     u8   tuple version = 1
1     u8   flags (1 = tombstone hint)
2     u64  xmin
10    u64  xmax (0 = live)
18    u16  ncolumns
20    null bitmap ceil(n/8)
then  values in catalog order, skipping nulls
```

Encodings: i64 8 bytes; decimal unscaled i128 16 bytes (high 64 then low 64); yesno 1 byte; day i32; stamp i64; text u32 length + bytes.

Row identity is `(page_id, slot, generation)`, never the user key.

Encrypted pages: AES-256-GCM over bytes 64..16367, tag in last 16 bytes, nonce = first 12 bytes of SHA-256(key || page_id || generation), AAD = page_id || object_id || generation || version. Header CRC covers plaintext before wrap.
