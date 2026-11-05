import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Animation } from '@/types/animation';
import { parseCsv } from './csv';
import { normalize } from './normalize';

function databaseFile() {
  const directory = process.env.ANIMATION_DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, 'animations.json');
}

export function readItems(): Animation[] {
  const file = databaseFile();
  try {
    const stored: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('Animation database must contain an array.');
    return stored.map((record: unknown) => {
      const item = normalize(record);
      if (!item || !record || typeof record !== 'object') return null;
      const previous = record as Partial<Animation>;
      return { ...item, updatedAt: previous.updatedAt || item.updatedAt };
    }).filter((item: Animation | null): item is Animation => item !== null);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const catalogue = path.join(process.cwd(), 'data', 'animation-catalogue.csv');
      if (!fs.existsSync(catalogue)) return [];
      return parseCsv(fs.readFileSync(catalogue, 'utf8'))
        .map(normalize).filter((item): item is Animation => item !== null);
    }
    throw error;
  }
}

export function getAnimationById(id: string): Animation | undefined {
  return readItems().find(item => item.id === id);
}

function writeItems(items: Animation[]) {
  const file = databaseFile();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

// Keep read/modify/write synchronous so requests in this Node process cannot interleave.
// Multiple server instances require a shared transactional database instead.
export function updateItems<T>(update: (items: Animation[]) => { items: Animation[]; result: T }): T {
  const { items, result } = update(readItems());
  writeItems(items);
  return result;
}
