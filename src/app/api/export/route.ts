import { readItems } from '@/lib/server/animation-store';
import { errorResponse } from '@/lib/server/http';

const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function GET() {
  try {
    const columns = ['ID', 'Animation', 'Collection', 'Category', 'Subcategory', 'Region', 'Actors', 'Search tags', 'Hashtags', 'Status', 'Capture notes', 'Description', 'References'];
    const rows = readItems().map(item => [
      item.id, item.title, item.collection, item.category, item.subcategory, item.region, item.actors,
      item.tags.join('; '), item.hashtags, item.status, item.captureNotes, item.description,
      item.references.map(reference => `${reference.title} <${reference.url}>`).join('; '),
    ].map(quote).join(','));
    return new Response(`\uFEFF${[columns.map(quote).join(','), ...rows].join('\r\n')}\r\n`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="Marksman_Animation_Catalogue.csv"', 'Cache-Control': 'no-store' },
    });
  } catch (error) { return errorResponse(error); }
}
