// Local test server: runs apps-script/Code.gs in Node against an in-memory
// fake of SpreadsheetApp & co., and serves the site. Not used in production.
//   node dev/mock-server.js [seed.json] [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const seedPath = process.argv[2] || path.join(__dirname, 'seed.json');
const PORT = Number(process.argv[3] || 8080);

// ---------------------------------------------------------------- fakes
function makeSheet(name) {
  const data = [];
  const sheet = {
    name,
    data,
    getLastRow() {
      for (let r = data.length - 1; r >= 0; r--) {
        if (data[r].some((v) => v !== '' && v !== null && v !== undefined)) return r + 1;
      }
      return 0;
    },
    getLastColumn() {
      let max = 0;
      data.forEach((row) => row.forEach((v, c) => { if (v !== '' && v != null) max = Math.max(max, c + 1); }));
      return max;
    },
    getRange(r, c, nr = 1, nc = 1) {
      const ensure = () => {
        while (data.length < r - 1 + nr) data.push([]);
        for (let i = 0; i < nr; i++) {
          const row = data[r - 1 + i];
          while (row.length < c - 1 + nc) row.push('');
        }
      };
      return {
        getValues() {
          ensure();
          const out = [];
          for (let i = 0; i < nr; i++) out.push(data[r - 1 + i].slice(c - 1, c - 1 + nc).map((v) => (v === undefined ? '' : v)));
          return out;
        },
        getDisplayValues() {
          return this.getValues().map((row) => row.map((v) => (v === '' || v == null ? '' : String(v))));
        },
        setValues(vals) {
          if (vals.length !== nr || vals.some((row) => row.length !== nc)) throw new Error('setValues size mismatch');
          ensure();
          vals.forEach((row, i) => row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }));
        },
        clearContent() {
          ensure();
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = '';
        }
      };
    },
    appendRow(row) {
      const at = sheet.getLastRow();
      while (data.length < at) data.push([]);
      data.splice(at, 0, row.slice());
    }
  };
  return sheet;
}

const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n))
};
const cache = {};
const props = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null),
      put: (k, v, s) => { cache[k] = { v, exp: Date.now() + s * 1000 }; },
      remove: (k) => { delete cache[k]; }
    })
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } })
  },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => ({ content: s, setMimeType() { return this; } })
  },
  Utilities: { getUuid: () => 'testkey1234567890' },
  Logger: { log: (m) => console.log('[gs]', m) },
  console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
ctx.setup();

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const pl = sheets.Players;
seed.players.forEach((p, i) => pl.getRange(i + 2, 1, 1, 4).setValues([[p.name, p.real, p.decoys[0], p.decoys[1]]]));
if (seed.address) sheets.Config.getRange(5, 2).setValues([[seed.address]]);

// ---------------------------------------------------------------- http
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    const parameter = Object.fromEntries(url.searchParams.entries());
    const out = ctx.doGet({ parameter });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(out.content);
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end("window.SMGO_CONFIG = { apiUrl: '/api' };");
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('Mock server on http://localhost:' + PORT + '  admin key: ' + props.ADMIN_KEY));
