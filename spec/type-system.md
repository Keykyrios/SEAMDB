# Type system — seamql/0.1

| Type | Storage | Notes |
|---|---|---|
| `whole number` | two’s-complement i64 | Overflow is `E_OVERFLOW`. No wrap. |
| `decimal(p,s)` | unscaled integer + scale `s`, `1 ≤ p ≤ 38`, `0 ≤ s ≤ p` | Precision is total digits. |
| `text` | UTF-8, max 1 MiB per value | Compare bytewise. |
| `yesno` | 0/1 | `yes`/`true` and `no`/`false`. |
| `stamp` | i64 microseconds since Unix epoch UTC | `now()` is STABLE per statement. |
| `day` | i32 days since Unix epoch UTC | `today()` is STABLE per statement. |
| `null` | type still present | Three-valued logic. |

No implicit casts. Allowed explicit `cast(x as T)` only for: integer↔decimal (if in range), text↔nothing else in v0 except `cast(whole number as text)` and `cast(decimal as text)`.

Division by zero: `E_DIV_ZERO`. Decimal `/` uses exact scale of the declared result context or `max(s1,s2)+6` truncated toward zero with `E_OVERFLOW` if precision exceeded.

Functions: `now()`, `today()`, `count`/`tally`, `sum`/`stack`, `min`, `max`, `avg`. Volatility: `now`/`today` STABLE; aggregates IMMUTABLE given inputs.

Collation: `utf8-binary`. Platform locale must not affect results.
