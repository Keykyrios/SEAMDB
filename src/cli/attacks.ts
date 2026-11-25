import { runAttackGallery } from "../engine/attacks";

const a = await runAttackGallery();
for (const r of a) {
  console.log(`${r.blocked ? "BLOCKED" : "LEAK "}  ${r.id}  ${r.name}`);
  console.log(`         expected=${r.expected} got=${r.got}  ${r.detail}`);
}
process.exit(a.every((x) => x.blocked) ? 0 : 1);
