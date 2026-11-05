import { updateItems } from '@/lib/server/animation-store';
import { mergeCatalogue, parseCatalogue } from '@/lib/server/catalogue-import';
import { errorResponse, readBody } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const imported = await parseCatalogue(await readBody(request));
    const result = updateItems(existing => mergeCatalogue(existing, imported));
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
