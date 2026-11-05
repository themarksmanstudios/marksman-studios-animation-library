import { readItems, updateItems } from '@/lib/server/animation-store';
import { normalize } from '@/lib/server/normalize';
import { errorResponse, HttpError, readBody } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try { return Response.json(readItems(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const item = normalize(await readBody(request));
    if (!item) throw new HttpError(400, 'Animation title is required.');
    updateItems(items => {
      if (items.some(existing => existing.id === item.id)) throw new HttpError(409, 'Animation ID already exists.');
      return { items: [item, ...items], result: item };
    });
    return Response.json(item, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
