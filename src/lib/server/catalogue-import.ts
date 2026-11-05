import { parseCsv } from './csv';
import { parseXlsx } from './xlsx';
import { normalize, text } from './normalize';
import { HttpError, MAX_BODY } from './http';
import type { Animation, ImportResult } from '@/types/animation';

export async function parseCatalogue(payload: Record<string, unknown>): Promise<Animation[]> {
  const filename = text(payload.filename, 180);
  const data = text(payload.data, MAX_BODY);
  let rows: unknown;
  if (/\.xlsx$/i.test(filename)) rows = await parseXlsx(Buffer.from(data, 'base64'));
  else if (/\.xls$/i.test(filename)) throw new HttpError(400, 'Legacy .xls files are not supported. Save the workbook as .xlsx.');
  else if (/\.json$/i.test(filename)) {
    try {
      const parsed = JSON.parse(data);
      rows = Array.isArray(parsed) ? parsed : parsed?.animations;
    } catch { throw new HttpError(400, 'The import file must contain valid JSON.'); }
  } else if (/\.csv$/i.test(filename)) rows = parseCsv(data);
  else throw new HttpError(400, 'Choose an .xlsx, .csv, or .json file.');
  if (!Array.isArray(rows)) throw new HttpError(400, 'JSON must contain an array or an animations array.');
  const imported = rows.map(normalize).filter((item): item is Animation => item !== null);
  if (!imported.length) throw new HttpError(400, 'No animation rows with a title were found. Check the first row for a Title or Animation column.');
  return imported;
}

export function mergeCatalogue(existing: Animation[], imported: Animation[]): { items: Animation[]; result: ImportResult } {
  const usesCatalogIds = imported.some(item => /^[A-Z]+-\d+$/.test(item.id));
  const key = (item: Animation) => usesCatalogIds ? item.id : item.title.toLowerCase();
  const keys = new Set(existing.map(key));
  const fresh = imported.filter(item => {
    if (keys.has(key(item))) return false;
    keys.add(key(item));
    return true;
  });
  return {
    items: [...fresh, ...existing],
    result: { imported: fresh.length, skipped: imported.length - fresh.length, total: imported.length },
  };
}
