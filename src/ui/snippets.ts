export const HERO_TS = `import { bootLab, runPipeline } from "./engine/control-plane";

const lab = await bootLab();
await runPipeline(lab);
const v = lab.verify;
if (!v) throw new Error("no verification result");
// fail-closed: missing checks never roll up to PASS
console.log(\`\${v.verdict}  \${v.verifier_version}\`);
for (const c of v.checks) {
  console.log(\`\${c.verdict.padEnd(13)} \${c.name}  \${c.code}\`);
}
`;

export const CAPTURE_TS = `import { captureSnapshot } from "./engine/connectors";

const cap = await captureSnapshot({
  source, rows, token, commitmentSecret, started_at,
});
// identical snapshot token → identical SHA-384 root
return cap.tree.root_commitment;
`;

export const POLICY_TS = `const decision = await evaluatePolicy(input);
if (!decision.allow) {
  lab.state = "DENIED";
  return; // no grant, no high-risk export
}
`;

export const VERIFY_TS = `const result = await verifyBundle({
  record, sourceTree, resultTree, log,
  inclusionProof, checkpoint, witnesses,
  requiredWitnesses: 2, algebraic, findings,
});
if (result.verdict !== "PASS") lab.state = "DENIED";
`;

/**
 * The "Proof by problem" landing-page script, run verbatim by
 * tests/demo-proof.test.ts. Keep the two in sync by exporting from here.
 */
export const LC183_SEAMQL = `-- LeetCode 183: Customers Who Never Order
-- spawn = DDL, drop in = insert, left link = LEFT JOIN.
spawn table folks: id: whole number, main key, name: text, needed
spawn table runs: rid: whole number, main key, folks_id: whole number, needed, links to folks.id, amount: decimal(12, 2), needed

drop in folks { id: 1, name: 'Ada' }
drop in folks { id: 2, name: 'Grace' }
drop in folks { id: 3, name: 'Linus' }
drop in runs { rid: 1, folks_id: 1, amount: 10.00 }

-- LEFT JOIN: customers with no runs null-extend, then the filter keeps them
pull folks.name as customers from folks left link runs on folks.id = runs.folks_id when runs.rid is null`;

/**
 * Scripts offered in the browser SQL IDE (src/ui/ide.ts). Each one runs
 * verbatim against the real in-memory engine — the same Database, parser and
 * planner the Node tests exercise. Keep them valid SEAMQL; the IDE renders
 * whatever the engine returns, errors included.
 */
export const IDE_SNIPPETS: Record<string, { label: string; code: string }> = {
  lc183: { label: "Customers Who Never Order", code: LC183_SEAMQL },
  index: {
    label: "Indexes & plans",
    code: `-- B+tree index: equality scans keep the plan node honest\nspawn table people: id: whole number, main key, name: text, needed\ndrop in people { id: 1, name: 'Ada' }\ndrop in people { id: 2, name: 'Grace' }\ndrop in people { id: 3, name: 'Linus' }\n\n-- equality before the index exists → heap scan\npull name from people when id = 3\n-- create the index, then the same query routes through it\nadd index people_by_id on people (id)\npull name from people when id = 3\n-- spill prints the physical plan (buffer-cache hits, cold session)\nspill pull name from people when id = 3`,
  },
  tx: {
    label: "MVCC: abort leaves no trace",
    code: `-- MVCC: readers never see uncommitted rows; an abort writes nothing\nspawn table ledger: id: whole number, main key, amount: whole number, needed\ndrop in ledger { id: 1, amount: 1 }\n\n-- explicit transaction\nstart tx\ndrop in ledger { id: 2, amount: 99 }\n-- read-your-writes: the transaction sees its own insert\npull id from ledger\n-- abort: every write above vanishes\ndip\n-- the snapshot now shows only id 1\npull id from ledger`,
  },
  errors: {
    label: "Fail closed",
    code: `-- Every failure is a typed E_* code with a source position. Never a crash.\nspawn table acc: id: whole number, main key, name: text, needed\ndrop in acc { id: 1, name: 'Ada' }\n\n-- duplicate main key → E_UNIQUE\ndrop in acc { id: 1, name: 'Mallory' }\n-- unknown column → E_UNKNOWN_NAME\npull ghost from acc\n-- unknown table → the resolver reports it as an unknown name too\npull id from nowhere`,
  },
};

export const INSTALL: Record<string, string> = {
  npm: "npm run verify",
  pnpm: "pnpm verify",
  yarn: "yarn verify",
  bun: "bun run verify",
};
