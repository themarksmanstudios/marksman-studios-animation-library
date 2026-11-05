import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../src/lib/server/csv';
import { parseCatalogue } from '../src/lib/server/catalogue-import';

test('CSV preserves quoted commas, quotes, and line breaks', () => {
  assert.deepEqual(parseCsv('\uFEFFTitle,Description\r\n"Walk, slow","A ""quoted"" note\nsecond line"'), [
    { Title: 'Walk, slow', Description: 'A "quoted" note\nsecond line' },
  ]);
});

test('XLSX imports the first worksheet with preamble rows and Unicode text', async () => {
  const data = readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'catalogue.xlsx')).toString('base64');
  const items = await parseCatalogue({ filename: 'catalogue.xlsx', data });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'CHAR-900');
  assert.equal(items[0].title, 'Café walk');
  assert.equal(items[0].status, 'Review');
  assert.equal(items[0].owner, 'Mira');
});

test('invalid XLSX content is reported as a validation error', async () => {
  await assert.rejects(parseCatalogue({ filename: 'broken.xlsx', data: Buffer.from('invalid zip').toString('base64') }), /valid .xlsx/);
});
