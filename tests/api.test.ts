import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GET, POST } from '../src/app/api/animations/route';
import { PUT, DELETE } from '../src/app/api/animations/[id]/route';
import { POST as IMPORT } from '../src/app/api/import/route';

const directory = mkdtempSync(path.join(tmpdir(), 'marksman-api-test-'));
const originalDirectory = process.env.ANIMATION_DATA_DIR;
const request = (data: unknown, method = 'POST') => new Request('http://localhost/api/animations', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.ANIMATION_DATA_DIR = directory;
  writeFileSync(path.join(directory, 'animations.json'), '[]\n');
});
after(() => {
  if (originalDirectory === undefined) delete process.env.ANIMATION_DATA_DIR;
  else process.env.ANIMATION_DATA_DIR = originalDirectory;
  rmSync(directory, { recursive: true, force: true });
});

test('existing records survive CRUD and retain their IDs and catalogue fields', async () => {
  const oldRecord = { id: 'LEGACY-001', title: 'Existing animation', category: 'Character', status: 'Planning', owner: '', priority: 'Normal', dueDate: '', description: 'Original brief', tags: '', updatedAt: '2025-01-01T00:00:00Z' };
  writeFileSync(path.join(directory, 'animations.json'), JSON.stringify([oldRecord]));
  assert.deepEqual(await GET().json(), [oldRecord]);
  const createdResponse = await POST(request({ title: 'Walk cycle', owner: 'Asha', priority: 'High' }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, 'Planned');
  assert.equal((await POST(request({ id: created.id, title: 'Duplicate' }))).status, 409);
  const updated = await PUT(request({ status: 'Review' }, 'PUT'), context(created.id));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).owner, 'Asha');
  const saved = JSON.parse(readFileSync(path.join(directory, 'animations.json'), 'utf8'));
  assert.equal(saved[0].status, 'Review');
  assert.deepEqual(saved[1], oldRecord);
  const deleted = await DELETE(new Request('http://localhost', { method: 'DELETE' }), context(created.id));
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.deepEqual(await GET().json(), [oldRecord]);
  assert.equal((await PUT(request({ title: 'Missing' }, 'PUT'), context('missing'))).status, 404);
  assert.equal((await DELETE(new Request('http://localhost'), context('missing'))).status, 404);
});

test('invalid requests return useful errors without altering the database', async () => {
  const before = readFileSync(path.join(directory, 'animations.json'), 'utf8');
  assert.equal((await POST(request({ title: '   ' }))).status, 400);
  assert.equal((await POST(request(null))).status, 400);
  const malformed = await POST(new Request('http://localhost', { method: 'POST', body: '{broken' }));
  assert.equal(malformed.status, 400);
  const oversized = await POST(new Request('http://localhost', { method: 'POST', body: '{}', headers: { 'Content-Length': String(13 * 1024 * 1024) } }));
  assert.equal(oversized.status, 413);
  assert.equal(readFileSync(path.join(directory, 'animations.json'), 'utf8'), before);
});

test('CSV catalogue aliases and repeated imports preserve metadata and skip duplicates', async () => {
  const data = 'Animation ID,Animation name,Production status,Collection,Search tags\r\nCHAR-001,"Walk, slow",planned,Locomotion,"walk, character"\r\nCHAR-001,"Walk, slow",planned,Locomotion,walk';
  const first = await IMPORT(request({ filename: 'catalogue.csv', data }));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { imported: 1, skipped: 1, total: 2 });
  const second = await IMPORT(request({ filename: 'catalogue.csv', data }));
  assert.deepEqual(await second.json(), { imported: 0, skipped: 2, total: 2 });
  const items = await GET().json();
  const imported = items.find((item: { id: string }) => item.id === 'CHAR-001');
  assert.equal(imported.title, 'Walk, slow');
  assert.equal(imported.status, 'Planned');
  assert.equal(imported.collection, 'Locomotion');
  assert.equal(imported.tags, 'walk, character');
});

test('JSON imports accept supported shapes and reject malformed files', async () => {
  const response = await IMPORT(request({ filename: 'catalogue.json', data: JSON.stringify({ animations: [{ title: 'Jump' }, { title: 'jump' }] }) }));
  assert.deepEqual(await response.json(), { imported: 1, skipped: 1, total: 2 });
  const array = await IMPORT(request({ filename: 'array.json', data: JSON.stringify([{ title: 'Run' }]) }));
  assert.equal(array.status, 200);
  for (const payload of [
    { filename: 'broken.json', data: '{bad' },
    { filename: 'wrong.json', data: '{"animations":{}}' },
    { filename: 'empty.csv', data: 'Owner\nAsha' },
    { filename: 'legacy.xls', data: 'bad' },
    { filename: 'wrong.txt', data: 'Title\nWalk' },
  ]) assert.equal((await IMPORT(request(payload))).status, 400);
});
