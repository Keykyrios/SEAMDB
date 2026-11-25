# SEAMDB — Demo Startup Guide

Everything runs from the repository root. Use three
separate terminals (or leave them open after running each block once).

## 1. Website (five pages, real engine in the browser)

```bash
npm install          # only needed once
npx vite --port 4900 --strictPort
```

Open: **http://localhost:4900/**

- `/` — home (proof-carrying evidence pitch)
- `/ide.html` — browser SQL IDE: run SEAMQL against the real engine
- `/lab.html` — SECP lab: seal a capsule, tamper a leaf, watch it FAIL
- `/specs.html` — architecture, crypto profile, threat model
- `/docs.html` — SEAMQL grammar + verb cheatsheet, CLI, drivers, format

> Tip: on this machine port 5173 is taken by another app, so use 4900.

## 2. Wire server (the database over TCP)

New terminal:

```bash
npx tsx src/server/tcp.ts --mem --port 7301
```

Expected output: `seamdb listening on 127.0.0.1:7301 (mode=development)`.
(`--mem` keeps data in RAM; drop `--mem` to persist to `./seamdata`.)

## 3. Desktop IDE (PyQt6 — SEAMDB Studio)

New terminal (server above must be running):

```bash
python ide/seamdb_ide.py --host 127.0.0.1 --port 7301 --user root --roles owner
```

A native VS Code-style window opens: schema explorer on the left
(live catalog), SEAMQL editor tabs with syntax highlighting in the middle,
results grid + plan pane at the bottom.

## Quick smoke demo inside the IDE (or the browser IDE)

```sql
spawn table folks: id: whole number, main key, name: text, needed
drop in folks { id: 1, name: 'Ada' }
pull name from folks when id = 1     -- returns Ada
yeet from folks when id = 1          -- yeet = DELETE
spill pull id from folks             -- prints the physical plan
```

## Tests / CLI (optional proof of correctness)

```bash
npm run engine:test   # 204 tests
npm run verify        # offline capsule verifier (exit 0 = full PASS)
npm run attacks       # 10 seeded attacks, all BLOCKED
```

## Stop everything

Ctrl+C in each terminal, or:
`taskkill /F /IM python.exe` (closes the IDE) — the browser server and the
wire server die with their terminals.
