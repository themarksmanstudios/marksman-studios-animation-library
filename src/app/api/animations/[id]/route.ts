import { updateItems } from '@/lib/server/animation-store';
import { normalize } from '@/lib/server/normalize';
import { errorResponse, HttpError, readBody } from '@/lib/server/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const data = await readBody(request);
    const item = updateItems(items => {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) throw new HttpError(404, 'Animation not found.');
      const item = normalize({ ...items[index], ...data, id });
      if (!item) throw new HttpError(400, 'Animation title is required.');
      items[index] = item;
      return { items, result: item };
    });
    return Response.json(item);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    updateItems(items => {
      const kept = items.filter(item => item.id !== id);
      if (kept.length === items.length) throw new HttpError(404, 'Animation not found.');
      return { items: kept, result: undefined };
    });
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
