# Test plan

Layers: grammar corpus, malformed corpus, type/null matrix, heap encode fuzz, WAL torn-tail, crash-after-N-writes, visibility/conflict schedules, index≡heap scan, policy matrix, backup checksum, production-build mock exclusion (no `MockAes` in `src/db`).

Runner: `npm run engine:test`. Exit 0 only if every assertion passes. CI must execute this script; file presence is not evidence.
