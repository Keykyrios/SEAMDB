import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../src/server/tcp";
import { SeamDB } from "../src/client";

const run = promisify(execFile);

const SCRIPT_TEMPLATE = `
import os, sys
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, "ide")
sys.path.insert(0, "drivers/python")

import seamdb_ide as studio
import seamdb
from PyQt6.QtWidgets import QApplication

app = QApplication([])

# 1. highlighter marks SEAMQL keywords, strings, comments differently
from PyQt6.QtGui import QTextDocument, QTextCharFormat, QFont
doc = QTextDocument()
doc.setDefaultFont(QFont("Consolas", 11))
hl = studio.SeamqlHighlighter(doc)
sql = "pull name from customers when region = 'west' -- hi"
doc.setPlainText(sql)
hl.rehighlight()
ranges = doc.firstBlock().layout().formats()
painted = [(fr.start, fr.length, fr.format.foreground().color().name()) for fr in ranges]
assert any(s == 0 and n == 4 and c == studio.C_KEYWORD for s, n, c in painted), f"keyword painted {painted}"
assert any(s == 39 and n == 6 and c == studio.C_STRING for s, n, c in painted), f"string painted {painted}"
assert any(s == 46 and n == 5 and c == studio.C_COMMENT for s, n, c in painted), f"comment painted {painted}"

# 2. real window constructs; tabs, explorer, results grid wired
win = studio.Studio()
assert win.tabs.count() == 1, "one starter tab"
assert win.explorer is not None
win.new_tab("extra.seamql", "pull 1 from customers")
assert win.tabs.count() == 2

# 3. live round trip through the real UI path: results grid + plan + messages
db = seamdb.connect(port={{PORT}}, user="root", roles=["owner"])
win.conn = db
win.refresh_schema()
win.catalog_worker.wait(10000)
app.processEvents()
assert win.explorer.topLevelItemCount() >= 1, "explorer filled"

tab = win.active_tab()
tab.editor.setPlainText("pull name, region from customers rank by customer_id")
win.run_current()
win.worker.wait(10000)
app.processEvents()
assert tab.grid.rowCount() == 2, f"grid rows {tab.grid.rowCount()}"
assert tab.grid.item(0, 0).text() in ("Ada", "Grace")
assert tab.plan.toPlainText().strip() != "", "plan pane filled"
assert "2 row(s)" in tab.messages.toPlainText(), tab.messages.toPlainText()

# 4. errors render in the messages pane with an error code
tab.editor.setPlainText("pull nope from customers")
win.run_current()
win.worker.wait(10000)
app.processEvents()
assert "E_UNKNOWN_NAME" in tab.messages.toPlainText(), tab.messages.toPlainText()

db.close()
print("IDE_OK")
`;

test("pyqt IDE: highlighter, explorer, results grid, plan and error panes work headlessly", async () => {
  const server = await startServer({ dir: null, mode: "development", port: 0 });
  try {
    const seed = await SeamDB.connect({ port: server.port, user: "root", roles: ["owner"] });
    await seed.query(`spawn table customers:\n  customer_id: whole number, main key,\n  name: text, needed,\n  region: text, fallback 'west'\n`);
    await seed.query(`drop in customers { customer_id: 1, name: 'Ada', region: 'west' }`);
    await seed.query(`drop in customers { customer_id: 2, name: 'Grace', region: 'east' }`);
    await seed.close();

    try {
      const script = SCRIPT_TEMPLATE.replace("{{PORT}}", String(server.port));
      const a = await run("python", ["-c", script], { timeout: 90_000, maxBuffer: 10_000_000 });
      assert.ok(a.stdout.includes("IDE_OK"), `stdout: ${a.stdout}\nstderr: ${a.stderr}`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      assert.fail(`IDE smoke failed\nstdout: ${err.stdout ?? ""}\nstderr: ${err.stderr ?? ""}`);
    }
  } finally {
    await server.close();
  }
});
