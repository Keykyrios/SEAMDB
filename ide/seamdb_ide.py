"""SEAMDB Studio — a native desktop IDE for SEAMDB, built with PyQt6.

Not a web page in a frame: a real Qt windows application with tabs, dockable
pads and a schema explorer, talking to a SEAMDB server over its native TCP
frame protocol (through the Python driver in drivers/python/seamdb.py).

Run:
    python ide/seamdb_ide.py                # connect dialog
    python ide/seamdb_ide.py --host 127.0.0.1 --port 7301 --user root --roles owner

Layout (VS Code style):
    Left:   schema explorer (tables, views, columns; double-click to edit)
    Center: QTabWidget of SEAMQL editor tabs (QPlainTextEdit + highlighting)
    Right/bottom: split results grid per tab, plan pane, problem list
    Status bar: connection state, identity, row counts, elapsed time
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Any

# Allow running from repo root or from ide/ without install.
sys.path.insert(0, "drivers/python")
sys.path.insert(0, "../drivers/python")

try:
    import seamdb
    from seamdb import SeamError
except ImportError as e:  # pragma: no cover
    print("Cannot import the seamdb driver:", e)
    print("Run this from the repository root:  python ide/seamdb_ide.py")
    sys.exit(1)

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QRegularExpression
from PyQt6.QtGui import (
    QColor, QFont, QKeySequence, QPixmap, QSyntaxHighlighter, QTextCharFormat,
    QAction, QShortcut,
)
from PyQt6.QtWidgets import (
    QApplication, QCheckBox, QDialog, QDialogButtonBox, QDockWidget, QFileDialog,
    QFormLayout, QGridLayout, QHBoxLayout, QHeaderView, QInputDialog, QLabel,
    QLineEdit, QMainWindow, QMenu, QMessageBox, QPlainTextEdit, QProgressBar,
    QPushButton, QStatusBar, QTableWidget, QTableWidgetItem, QTabWidget,
    QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget, QSplitter, QToolBar,
    QStyle,
)

# ------------------------------------------------------------------ theme

MONO = "Consolas"

SEAMQL_KEYWORDS = [
    # Canonical surface + frozen aliases (spec/seamql-grammar.md). Kept in
    # sync with src/ui/highlight.ts and the lexer: a word listed here is a
    # reserved word the engine really parses.
    "spawn", "make", "table", "drop", "in", "add", "to", "insert", "into",
    "tweak", "change", "yeet", "remove", "from", "when", "where", "set",
    "pull", "read", "select", "bunch", "group", "by", "having", "rank",
    "sort", "order", "cap", "take", "limit", "skip", "offset", "link",
    "join", "left", "right", "full", "cross", "inner", "outer", "on", "as",
    "and", "or", "not", "null", "yes", "no", "true", "false", "start",
    "begin", "tx", "transaction", "lock", "lockin", "dip", "cancel",
    "commit", "rollback", "spill", "explain", "check", "verify", "fah",
    "faah", "ship", "export", "sealed", "let", "allow", "block", "deny",
    "role", "main", "primary", "key", "needed", "required", "private",
    "unique", "fallback", "default", "links", "at", "least", "index",
    "create", "view", "with", "union", "all", "intersect", "except",
    "distinct", "partition", "over", "high", "low", "descending",
    "ascending", "case", "then", "else", "end", "exists", "like", "is",
    "cast", "tally", "stack",
]

# VS Code Dark+ inspired palette
C_KEYWORD = "#569cd6"
C_TYPE = "#4ec9b0"
C_STRING = "#ce9178"
C_NUMBER = "#b5cea8"
C_COMMENT = "#6a9955"
C_FUNCTION = "#dcdcaa"
C_BG = "#1e1e1e"
C_FG = "#d4d4d4"


def _fmt(color: str, bold: bool = False) -> QTextCharFormat:
    f = QTextCharFormat()
    f.setForeground(QColor(color))
    if bold:
        f.setFontWeight(QFont.Weight.Bold)
    return f


FORMATS = {
    "kw":   _fmt(C_KEYWORD),
    "type": _fmt(C_TYPE),
    "str":  _fmt(C_STRING),
    "num":  _fmt(C_NUMBER),
    "com":  _fmt(C_COMMENT),
    "fn":   _fmt(C_FUNCTION),
}


# ------------------------------------------------------------- highlighter

class SeamqlHighlighter(QSyntaxHighlighter):
    """Real SEAMQL (and SQL-skin) highlighting: keywords, types, strings,
    numbers, comments, aggregate/window function calls."""

    KW_RULES: list[tuple[QRegularExpression, QTextCharFormat]] = []

    def __init__(self, doc) -> None:
        super().__init__(doc)
        if not SeamqlHighlighter.KW_RULES:
            words = sorted(set(w.strip() for w in SEAMQL_KEYWORDS if w.strip()), key=len, reverse=True)
            joined = "|".join(words)
            SeamqlHighlighter.KW_RULES = [
                (QRegularExpression(r"--[^\n]*"), FORMATS["com"]),
                (QRegularExpression(r"/\*.*?\*/"), FORMATS["com"]),
                (QRegularExpression(r"'([^'\\]|\\.)*'?"), FORMATS["str"]),
                (QRegularExpression(r"\b\d+(\.\d+)?\b"), FORMATS["num"]),
                (QRegularExpression(
                    rf"\b(tally|stack|count|sum|avg|min|max|row_number|dense_rank|lead|lag)\b(?=\s*\()"),
                 FORMATS["fn"]),
                (QRegularExpression(
                    rf"\b({joined})\b", QRegularExpression.PatternOption.CaseInsensitiveOption),
                 FORMATS["kw"]),
            ]
        self.rules = SeamqlHighlighter.KW_RULES

    def highlightBlock(self, text: str) -> None:  # noqa: N802 (Qt API)
        for rx, fmt in self.rules:
            it = rx.globalMatch(text)
            while it.hasNext():
                m = it.next()
                if m.capturedLength() > 0:
                    self.setFormat(m.capturedStart(), m.capturedLength(), fmt)
        # unbalanced string: keep the rest of the line amber
        opens = text.count("'") % 2 == 1
        if opens:
            start = text.rindex("'")
            self.setFormat(start, len(text) - start, FORMATS["str"])
            self.setCurrentBlockState(1)
        else:
            self.setCurrentBlockState(0)


# ------------------------------------------------------------------ editor

class Editor(QPlainTextEdit):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        f = QFont(MONO, 11)
        f.setFixedPitch(True)
        self.setFont(f)
        self.setStyleSheet(f"QPlainTextEdit {{ background: {C_BG}; color: {C_FG}; border: none; }}")
        self.setTabStopDistance(4 * self.fontMetrics().horizontalAdvance(" "))
        self.highlighter = SeamqlHighlighter(self.document())

    def keyPressEvent(self, e) -> None:
        if e.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and not e.modifiers():
            # auto-indent: copy the leading whitespace of the current line
            cur = self.textCursor()
            block = cur.block().text()
            indent = block[: len(block) - len(block.lstrip())]
            super().keyPressEvent(e)
            self.insertPlainText(indent)
            return
        if e.key() == Qt.Key.Key_Tab:
            self.textCursor().insertText("    ")
            return
        super().keyPressEvent(e)


class EditorTab(QWidget):
    """One open file/page: editor on top, tabbed bottom pane with the
    results grid and the plan text."""

    def __init__(self, title: str = "untitled.seamql", content: str = "") -> None:
        super().__init__()
        self.path: str | None = None
        self.dirty = False
        self.title = title

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        split = QSplitter(Qt.Orientation.Vertical)
        layout.addWidget(split)

        self.editor = Editor()
        self.editor.setPlainText(content)
        split.addWidget(self.editor)

        bottom = QTabWidget()
        bottom.setDocumentMode(True)
        self.bottom = bottom
        self.grid = ResultsGrid()
        bottom.addTab(self.grid, "Results")
        self.plan = QPlainTextEdit()
        self.plan.setReadOnly(True)
        f = QFont(MONO, 10)
        self.plan.setFont(f)
        self.plan.setStyleSheet(f"QPlainTextEdit {{ background: {C_BG}; color: #9cdcfe; }}")
        bottom.addTab(self.plan, "Plan")
        self.messages = QPlainTextEdit()
        self.messages.setReadOnly(True)
        self.messages.setFont(f)
        self.messages.setStyleSheet(f"QPlainTextEdit {{ background: {C_BG}; color: #f48771; }}")
        bottom.addTab(self.messages, "Messages")
        bottom.setCurrentIndex(0)
        split.addWidget(bottom)
        split.setSizes([600, 240])

        self.editor.textChanged.connect(self._changed)
        self.executed_at = 0.0

    def _changed(self) -> None:
        self.dirty = True

    def current_text(self) -> str:
        cur = self.editor.textCursor()
        if cur.hasSelection():
            return cur.selectedText().replace("\u2029", "\n")
        return self.editor.toPlainText()


class ResultsGrid(QTableWidget):
    """The results spreadsheet: display-text cells, copied as shown."""

    def __init__(self) -> None:
        super().__init__()
        self.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.setAlternatingRowColors(True)
        self.setStyleSheet(
            f"QTableWidget {{ background: {C_BG}; color: {C_FG};"
            f" gridline-color: #333; alternate-background-color: #252526; }}"
            "QHeaderView::section { background: #333; color: #d4d4d4;"
            " border: none; padding: 3px 6px; }"
        )
        self.horizontalHeader().setStretchLastSection(True)

    def show_result(self, res: Any) -> None:
        self.clear()
        cols = res.columns or ["(no columns)"]
        self.setColumnCount(len(cols))
        self.setRowCount(0)
        self.setHorizontalHeaderLabels(cols)
        rows = res.rows if hasattr(res, "rows") else []
        for r in rows:
            row = self.rowCount()
            self.insertRow(row)
            for c, name in enumerate(cols):
                item = QTableWidgetItem("" if r.get(name) is None else str(r.get(name)))
                item.setForeground(QColor(C_FG))
                self.setItem(row, c, item)
        self.resizeColumnsToContents()
        self.horizontalHeader().setStretchLastSection(True)

    def show_many(self, results: list[Any]) -> None:
        # one grid shows the first; later results replace it
        if results:
            self.show_result(results[0])


# ----------------------------------------------------------- async worker

class QueryWorker(QThread):
    done = pyqtSignal(object, float)       # results, elapsed
    failed = pyqtSignal(object, float)     # SeamError, elapsed

    def __init__(self, conn, seamql: str, timeout_ms: int) -> None:
        super().__init__()
        self.conn = conn
        self.seamql = seamql
        self.timeout_ms = timeout_ms

    def run(self) -> None:
        t0 = time.perf_counter()
        try:
            res = self.conn.query(self.seamql, timeout_ms=self.timeout_ms)
            self.done.emit(res, time.perf_counter() - t0)
        except SeamError as e:
            self.failed.emit(e, time.perf_counter() - t0)


class CatalogWorker(QThread):
    ready = pyqtSignal(object)

    def __init__(self, conn) -> None:
        super().__init__()
        self.conn = conn

    def run(self) -> None:
        try:
            self.ready.emit(self.conn.catalog())
        except SeamError:
            self.ready.emit({"tables": [], "views": [], "roles": {}})


# ------------------------------------------------------------ main window

class ConnectDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Connect to SEAMDB")
        form = QFormLayout(self)
        self.host = QLineEdit("127.0.0.1")
        self.port = QLineEdit("7301")
        self.user = QLineEdit("root")
        self.roles = QLineEdit("owner")
        form.addRow("Host", self.host)
        form.addRow("Port", self.port)
        form.addRow("User", self.user)
        form.addRow("Roles (comma-separated)", self.roles)
        bb = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        form.addRow(bb)

    def values(self) -> dict[str, Any]:
        roles = [r.strip() for r in self.roles.text().split(",") if r.strip()]
        return {
            "host": self.host.text() or "127.0.0.1",
            "port": int(self.port.text() or "7301"),
            "user": self.user.text() or "root",
            "roles": roles,
        }


class Studio(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.conn = None
        self.worker: QueryWorker | None = None
        self.setWindowTitle("SEAMDB Studio")
        self.resize(1400, 900)
        self.setDockNestingEnabled(True)

        # ---- central: tabbed editors
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.setTabsClosable(True)
        self.tabs.setMovable(True)
        self.tabs.tabCloseRequested.connect(self.close_tab)
        self.setCentralWidget(self.tabs)
        self.new_tab("scratch.seamql", "-- SEAMQL lives here. Ctrl+Enter runs "
                                           "the buffer.\n-- pull name from customers when region = 'west'\n")

        # ---- explorer dock
        self.explorer = QTreeWidget()
        self.explorer.setHeaderLabels(["Schema"])
        self.explorer.setStyleSheet(f"QTreeWidget {{ background: {C_BG}; color: {C_FG}; }}")
        self.explorer.itemDoubleClicked.connect(self.explorer_dbl)
        dock = QDockWidget("Schema Explorer", self)
        dock.setWidget(self.explorer)
        self.addDockWidget(Qt.DockWidgetArea.LeftDockWidgetArea, dock)
        self.docks = [dock]

        # ---- status bar
        sb = QStatusBar()
        self.setStatusBar(sb)
        self.status_conn = QLabel("disconnected")
        self.status_time = QLabel("")
        sb.addWidget(self.status_conn)
        sb.addPermanentWidget(self.status_time)

        self._build_menu()
        self._build_toolbar()
        self.refresh_timer = QTimer(self)
        self.refresh_timer.setSingleShot(True)

    # ---------- menus ----------

    def _build_menu(self) -> None:
        m = self.menuBar()
        fm = m.addMenu("&File")
        act_new = QAction("&New Tab", self)
        act_new.setShortcut(QKeySequence("Ctrl+N"))
        act_new.triggered.connect(lambda: self.new_tab())
        act_open = QAction("&Open File…", self)
        act_open.setShortcut(QKeySequence("Ctrl+O"))
        act_open.triggered.connect(self.open_file)
        act_save = QAction("&Save", self)
        act_save.setShortcut(QKeySequence("Ctrl+S"))
        act_save.triggered.connect(self.save_tab)
        act_saveas = QAction("Save &As…", self)
        act_saveas.setShortcut(QKeySequence("Ctrl+Shift+S"))
        act_saveas.triggered.connect(self.save_tab_as)
        fm.addActions([act_new, act_open, act_save, act_saveas])

        qm = m.addMenu("&Query")
        act_run = QAction("&Execute Buffer", self)
        act_run.setShortcut(QKeySequence("Ctrl+Enter"))
        act_run.triggered.connect(self.run_current)
        act_sel = QAction("Execute &Selected", self)
        act_sel.setShortcut(QKeySequence("Ctrl+Shift+Enter"))
        act_sel.triggered.connect(self.run_current)
        qm.addActions([act_run, act_sel])

        dm = m.addMenu("&Database")
        act_conn = QAction("&Connect…", self)
        act_conn.setShortcut(QKeySequence("Ctrl+K"))
        act_conn.triggered.connect(self.connect_dialog)
        act_disc = QAction("&Disconnect", self)
        act_disc.triggered.connect(self.disconnect)
        act_cat = QAction("Refresh &Schema", self)
        act_cat.setShortcut(QKeySequence("F5"))
        act_cat.triggered.connect(self.refresh_schema)
        dm.addActions([act_conn, act_disc, act_cat])

    def _build_toolbar(self) -> None:
        tb = QToolBar("Run")
        tb.setMovable(False)
        self.addToolBar(tb)
        icon = self.style().standardIcon(QStyle.StandardPixmap.SP_MediaPlay if hasattr(QStyle.StandardPixmap, "SP_MediaPlay") else QStyle.StandardPixmap.SP_ArrowForward)
        run = QAction(icon, "Execute (Ctrl+Enter)", self)
        run.triggered.connect(self.run_current)
        tb.addAction(run)
        connect = QAction(self.style().standardIcon(QStyle.StandardPixmap.SP_ComputerIcon), "Connect (Ctrl+K)", self)
        connect.triggered.connect(self.connect_dialog)
        tb.addAction(connect)
        refresh = QAction(self.style().standardIcon(QStyle.StandardPixmap.SP_BrowserReload), "Refresh schema (F5)", self)
        refresh.triggered.connect(self.refresh_schema)
        tb.addAction(refresh)

    # ---------- tabs ----------

    def new_tab(self, title: str | None = None, content: str = "") -> EditorTab:
        n = self.tabs.count() + 1
        tab = EditorTab(title or f"query{n}.seamql", content)
        idx = self.tabs.addTab(tab, tab.title)
        self.tabs.setTabToolTip(idx, "unsaved" if not tab.path else tab.path)
        self.tabs.setCurrentIndex(idx)
        tab.editor.setFocus()
        return tab

    def close_tab(self, idx: int) -> None:
        self.tabs.removeTab(idx)

    def active_tab(self) -> EditorTab:
        return self.tabs.currentWidget()

    # ---------- file ops ----------

    def open_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Open SEAMQL", "", "SEAMQL (*.seamql *.seam *.sql *.txt);;All files (*)")
        if not path:
            return
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        import os
        tab = self.new_tab(os.path.basename(path), content)
        tab.path = path
        tab.dirty = False

    def save_tab(self) -> None:
        tab = self.active_tab()
        if not tab.path:
            self.save_tab_as()
            return
        with open(tab.path, "w", encoding="utf-8") as f:
            f.write(tab.editor.toPlainText())
        tab.dirty = False
        self.tabs.setTabText(self.tabs.currentIndex(), tab.title)

    def save_tab_as(self) -> None:
        tab = self.active_tab()
        path, _ = QFileDialog.getSaveFileName(self, "Save SEAMQL", tab.title, "SEAMQL (*.seamql);;All files (*)")
        if not path:
            return
        tab.path = path
        with open(path, "w", encoding="utf-8") as f:
            f.write(tab.editor.toPlainText())
        tab.dirty = False

    # ---------- connection ----------

    def connect_dialog(self) -> None:
        dlg = ConnectDialog(self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        v = dlg.values()
        try:
            self.conn = seamdb.connect(host=v["host"], port=v["port"], user=v["user"], roles=v["roles"])
        except Exception as e:
            QMessageBox.critical(self, "Connect failed", str(e))
            self.conn = None
            self.status_conn.setText("disconnected")
            return
        who = self.conn.catalog().get("roles", {})
        self.status_conn.setText(f"connected as {who.get('user', v['user'])} "
                                 f"({', '.join(who.get('roles', [])) or 'no roles'}) @ {v['host']}:{v['port']}")
        self.refresh_schema()

    def disconnect(self) -> None:
        if self.conn:
            self.conn.close()
            self.conn = None
        self.status_conn.setText("disconnected")
        self.explorer.clear()

    def refresh_schema(self) -> None:
        if not self.conn:
            QMessageBox.information(self, "SEAMDB Studio", "Not connected. Ctrl+K to connect.")
            return
        self.catalog_worker = CatalogWorker(self.conn)
        self.catalog_worker.ready.connect(self._fill_explorer)
        self.catalog_worker.start()

    def _fill_explorer(self, cat: dict) -> None:
        self.explorer.clear()
        tables = QTreeWidgetItem(self.explorer, ["Tables"])
        for t in cat.get("tables", []):
            node = QTreeWidgetItem(tables, [t["name"]])
            for c in t.get("columns", []):
                flags = []
                if c.get("mainKey"):
                    flags.append("PK")
                if c.get("needed"):
                    flags.append("NOT NULL")
                if c.get("unique"):
                    flags.append("UQ")
                label = f"{c['name']} : {c['type']}" + (f"  ({', '.join(flags)})" if flags else "")
                QTreeWidgetItem(node, [label])
            for idx in t.get("indexes", []):
                QTreeWidgetItem(node, [f"idx {idx['name']}({', '.join(idx['columns'])})" + (" UNIQUE" if idx.get("unique") else "")])
        views = QTreeWidgetItem(self.explorer, ["Views"])
        for v in cat.get("views", []):
            QTreeWidgetItem(views, [v["name"]])
        self.explorer.expandAll()

    def explorer_dbl(self, item: QTreeWidgetItem, _col: int) -> None:
        text = item.text(0)
        if " : " in text and item.parent() and item.parent().parent():
            table = item.parent().text(0)
            col = text.split(" : ")[0]
            self.new_tab(f"{table}.seamql", f"pull {col} from {table}\n")

    # ---------- execution ----------

    def run_current(self) -> None:
        tab = self.active_tab()
        if not tab:
            return
        if not self.conn:
            QMessageBox.information(self, "SEAMDB Studio", "Not connected. Ctrl+K to connect.")
            return
        cur = tab.editor.textCursor()
        if cur.hasSelection():
            sql = cur.selectedText().replace("\u2029", "\n")
        else:
            sql = tab.editor.toPlainText()
        if not sql.strip():
            return
        tab.messages.clear()
        self.status_time.setText("running…")
        tab.editor.setReadOnly(True)
        self.worker = QueryWorker(self.conn, sql, 30000)
        self.worker.done.connect(self._query_done)
        self.worker.failed.connect(self._query_failed)
        self.worker.start()

    def _query_done(self, results, elapsed: float) -> None:
        tab = self.active_tab()
        tab.editor.setReadOnly(False)
        tab.grid.show_many(results)
        lines: list[str] = []
        plans: list[str] = []
        for i, res in enumerate(results):
            n = len(res.rows) if hasattr(res, "rows") else 0
            cols = ", ".join(res.columns) if res.columns else "(none)"
            lines.append(f"[{i}] {n} row(s) — columns: {cols} — xid {res.xid} (evidence: {res.evidence_state})")
            if getattr(res, "plan", None):
                plans.append(str(res.plan))
        tab.messages.setPlainText("\n".join(lines) or "(no results)")
        tab.plan.setPlainText("\n\n".join(plans))
        tab.bottom.setCurrentIndex(0)
        self.status_time.setText(f"{len(results)} statement(s), {elapsed * 1000:.1f} ms")

    def _query_failed(self, err, elapsed: float) -> None:
        tab = self.active_tab()
        tab.editor.setReadOnly(False)
        msg = f"ERROR [{err.code}] {err}"
        pos = ""
        if getattr(err, "line", None):
            pos = f" (line {err.line}, column {err.column})" if err.column else f" (line {err.line})"
        if getattr(err, "hint", None):
            msg += f"\nHINT: {err.hint}"
        tab.messages.setPlainText(msg + pos)
        self.status_time.setText(f"failed after {elapsed * 1000:.1f} ms")


def main() -> None:
    ap = argparse.ArgumentParser(description="SEAMDB Studio (PyQt6)")
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--user", default=None)
    ap.add_argument("--roles", default=None, help="comma-separated roles")
    args = ap.parse_args()

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = Studio()
    win.show()
    if args.host and args.port and args.user:
        try:
            roles = [r for r in (args.roles or "owner").split(",") if r]
            win.conn = seamdb.connect(host=args.host, port=args.port, user=args.user, roles=roles)
            who = win.conn.catalog().get("roles", {})
            win.status_conn.setText(f"connected as {who.get('user', args.user)} @ {args.host}:{args.port}")
            win.refresh_schema()
        except Exception as e:
            QMessageBox.critical(win, "Connect failed", str(e))
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
