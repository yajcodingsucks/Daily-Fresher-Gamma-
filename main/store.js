// A tiny wrapper around SQLite so the rest of the code doesn't care which SQLite library runs it.
// The app uses sql.js (pure JavaScript/WebAssembly, nothing to compile on Windows).
// After every change the whole database is written to disk (safely: temp file + rename).

const fs = require('fs');
const path = require('path');

class Store {
  constructor(adapter, filePath) {
    this.a = adapter;          // { run, all, get, exec, export? }
    this.filePath = filePath;  // null = in memory only (tests)
    this.depth = 0;
  }

  run(sql, params = []) { return this.a.run(sql, params); }
  all(sql, params = []) { return this.a.all(sql, params); }
  get(sql, params = []) { return this.a.get(sql, params); }
  exec(sql) { this.a.exec(sql); }

  // Run fn inside one transaction: either everything is saved or nothing is.
  tx(fn) {
    if (this.depth > 0) return fn();
    this.depth++;
    this.a.exec('BEGIN');
    try {
      const out = fn();
      this.a.exec('COMMIT');
      this.persist();
      return out;
    } catch (err) {
      try { this.a.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    } finally {
      this.depth--;
    }
  }

  persist() {
    if (!this.filePath || !this.a.export) return;
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.a.export()));
    fs.renameSync(tmp, this.filePath);
  }
}

// ---- sql.js adapter (used by the real app) ----
async function openSqlJs(filePath) {
  const initSqlJs = require('sql.js');
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = fs.existsSync(filePath) ? new SQL.Database(fs.readFileSync(filePath)) : new SQL.Database();

  const rows = (sql, params) => {
    const st = db.prepare(sql);
    try {
      st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  };

  const adapter = {
    run(sql, params) {
      db.run(sql, params);
      const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
      return { changes: db.getRowsModified(), lastId: id };
    },
    all: rows,
    get: (sql, params) => rows(sql, params)[0],
    exec: (sql) => db.exec(sql),
    export: () => db.export(),
  };
  adapter.exec('PRAGMA foreign_keys = ON');
  return new Store(adapter, filePath);
}

// ---- node:sqlite adapter (used by the automated tests only) ----
function openNodeSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const clean = (r) => (r ? { ...r } : r);
  const adapter = {
    run(sql, params) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    all: (sql, params) => db.prepare(sql).all(...params).map(clean),
    get: (sql, params) => clean(db.prepare(sql).get(...params)),
    exec: (sql) => db.exec(sql),
  };
  adapter.exec('PRAGMA foreign_keys = ON');
  return new Store(adapter, null);
}

module.exports = { Store, openSqlJs, openNodeSqlite };
