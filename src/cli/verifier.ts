import { bootLab, runPipeline } from "../engine/control-plane";
import { runAttackGallery } from "../engine/attacks";
import { runKnownAnswers } from "../engine/vectors";

async function main() {
  const mode = process.argv[2] ?? "verify";
  if (mode === "vectors") {
    const v = await runKnownAnswers();
    for (const r of v) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.detail.slice(0, 80)}`);
    process.exit(v.every((x) => x.pass) ? 0 : 1);
  }
  if (mode === "attacks") {
    const a = await runAttackGallery();
    for (const r of a) console.log(`${r.blocked ? "BLOCKED" : "LEAK"}  ${r.id} ${r.name}  got=${r.got}  ${r.detail}`);
    process.exit(a.every((x) => x.blocked) ? 0 : 1);
  }
  const lab = await bootLab();
  await runPipeline(lab);
  const v = lab.verify;
  if (!v) {
    console.error("no verification result");
    process.exit(2);
  }
  console.log(`verdict=${v.verdict} version=${v.verifier_version}`);
  for (const c of v.checks) {
    console.log(`${c.verdict.padEnd(13)} ${c.name.padEnd(20)} ${c.code}  ${c.artifact.slice(0, 64)}`);
  }
  if (v.verdict !== "PASS") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
