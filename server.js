const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'animations.json');
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 12 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');

function readItems() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeItems(items) { fs.writeFileSync(DB_FILE, `${JSON.stringify(items, null, 2)}\n`, 'utf8'); }
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { reject(new Error('Request is too large (12 MB maximum).')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
function normalize(row) {
  const fields = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
  const pick = (...keys) => { for (const key of keys) if (fields[key] != null && String(fields[key]).trim()) return fields[key]; return ''; };
  const title = text(pick('title', 'animation', 'name', 'animationname'), 160);
  if (!title) return null;
  const statuses = ['Planning', 'In Progress', 'Review', 'Approved', 'Archived'];
  const statusText = text(pick('status', 'stage'), 40).toLowerCase();
  const status = statuses.find(s => s.toLowerCase() === statusText) || 'Planning';
  return {
    id: text(pick('id'), 80) || crypto.randomUUID(), title,
    category: text(pick('category', 'type', 'department'), 100),
    status, owner: text(pick('owner', 'artist', 'assignee', 'lead'), 100),
    priority: ['Low', 'Normal', 'High', 'Urgent'].find(p => p.toLowerCase() === text(pick('priority'), 30).toLowerCase()) || 'Normal',
    dueDate: text(pick('duedate', 'deadline', 'targetdate'), 20),
    description: text(pick('description', 'notes', 'brief', 'summary'), 1200),
    tags: text(pick('tags', 'keywords'), 200), updatedAt: new Date().toISOString()
  };
}
function parseXlsx(buffer, filename) {
  return new Promise((resolve, reject) => {
    const temp = path.join(DATA_DIR, `import-${crypto.randomUUID()}.xlsx`);
    fs.writeFileSync(temp, buffer);
    const script = path.join(ROOT, 'scripts', 'read_xlsx.py');
    const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
    let idx = 0;
    const attempt = () => {
      if (idx >= candidates.length) { fs.rmSync(temp, { force: true }); return reject(new Error('Python is required to read Excel workbooks.')); }
      const cmd = candidates[idx++];
      const args = cmd === 'py' ? ['-3', script, temp] : [script, temp];
      const child = spawn(cmd, args, { windowsHide: true });
      let out = '', err = '';
      child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
      child.on('error', e => { if (e.code === 'ENOENT') attempt(); else { fs.rmSync(temp, { force: true }); reject(e); } });
      child.on('close', code => {
        fs.rmSync(temp, { force: true });
        if (code !== 0) return reject(new Error(err.trim() || `Could not read ${filename}.`));
        try { resolve(JSON.parse(out)); } catch { reject(new Error('The workbook could not be read as a valid Excel file.')); }
      });
    };
    attempt();
  });
}
function parseCsv(source) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/animations' && req.method === 'GET') return send(res, 200, readItems());
    if (url.pathname === '/api/animations' && req.method === 'POST') {
      const item = normalize(await readBody(req));
      if (!item) return send(res, 400, { error: 'Animation title is required.' });
      const items = readItems(); items.unshift(item); writeItems(items); return send(res, 201, item);
    }
    const match = url.pathname.match(/^\/api\/animations\/([^/]+)$/);
    if (match && req.method === 'PUT') {
      const id = decodeURIComponent(match[1]); const data = await readBody(req); const items = readItems();
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return send(res, 404, { error: 'Animation not found.' });
      const item = normalize({ ...items[index], ...data, id });
      if (!item) return send(res, 400, { error: 'Animation title is required.' });
      items[index] = item; writeItems(items); return send(res, 200, item);
    }
    if (match && req.method === 'DELETE') {
      const id = decodeURIComponent(match[1]); const items = readItems();
      const kept = items.filter(item => item.id !== id);
      if (kept.length === items.length) return send(res, 404, { error: 'Animation not found.' });
      writeItems(kept); return send(res, 204, '');
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      const payload = await readBody(req); const filename = text(payload.filename, 180); const data = text(payload.data, MAX_BODY);
      let rows;
      if (/\.xlsx?$/i.test(filename)) rows = await parseXlsx(Buffer.from(data, 'base64'), filename);
      else if (/\.json$/i.test(filename)) { const parsed = JSON.parse(data); rows = Array.isArray(parsed) ? parsed : (parsed.animations || []); }
      else rows = parseCsv(data);
      const imported = rows.map(normalize).filter(Boolean);
      if (!imported.length) return send(res, 400, { error: 'No animation rows with a title were found. Check the first row for a Title or Animation column.' });
      const existing = readItems(); const keys = new Set(existing.map(x => x.title.toLowerCase()));
      const fresh = imported.filter(item => !keys.has(item.title.toLowerCase()));
      writeItems([...fresh, ...existing]);
      return send(res, 200, { imported: fresh.length, skipped: imported.length - fresh.length, total: imported.length });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found.' });
    const requestPath = decodeURIComponent(url.pathname);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^[/\\]+/, '');
    const file = path.resolve(PUBLIC, relativePath);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    send(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Marksman Animation Library is running at http://127.0.0.1:${PORT}`));
