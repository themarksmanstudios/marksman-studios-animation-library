import crypto from 'node:crypto';
import { STATUSES, PRIORITIES, type Animation } from '@/types/animation';

export const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
export function normalize(row: unknown): Animation | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const fields = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
  const pick = (...keys: string[]) => { for (const key of keys) if (fields[key] != null && String(fields[key]).trim()) return fields[key]; return ''; };
  const title = text(pick('title', 'animation', 'name', 'animationname'), 160);
  if (!title) return null;
  const statuses = STATUSES;
  const statusText = text(pick('status', 'stage', 'productionstatus'), 40).toLowerCase();
  const statusAliases: Record<string, typeof STATUSES[number]> = {
    planning: 'Planned', 'in progress': 'Captured', approved: 'Published', archived: 'Published',
  };
  const status = statusAliases[statusText] || statuses.find(s => s.toLowerCase() === statusText) || 'Planned';
  return {
    id: text(pick('id', 'animationid', 'sourceid'), 80) || crypto.randomUUID(), title,
    category: text(pick('category', 'type', 'department'), 100),
    status,
    collection: text(pick('collection'), 100),
    subcategory: text(pick('subcategory'), 100),
    region: text(pick('regionscope', 'region'), 120),
    actors: text(pick('actors', 'actor', 'performers', 'performer', 'talent'), 240),
    tags: text(pick('tags', 'keywords', 'searchtags'), 800).split(/[;,]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean),
    hashtags: text(pick('profilehashtags', 'hashtags'), 600),
    captureNotes: text(pick('capturenotes'), 1200),
    references: Array.isArray(fields.references) ? fields.references as Animation['references'] : [],
    owner: text(pick('owner', 'artist', 'assignee', 'lead'), 100),
    priority: PRIORITIES.find(p => p.toLowerCase() === text(pick('priority'), 30).toLowerCase()) || 'Normal',
    dueDate: text(pick('duedate', 'deadline', 'targetdate'), 20),
    description: text(pick('description', 'notes', 'brief', 'summary'), 1200), updatedAt: new Date().toISOString()
  };
}
