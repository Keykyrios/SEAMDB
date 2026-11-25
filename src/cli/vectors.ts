import { runKnownAnswers } from "../engine/vectors";

const v = await runKnownAnswers();
for (const r of v) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n  ${r.detail}`);
process.exit(v.every((x) => x.pass) ? 0 : 1);
