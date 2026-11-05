import { addReferenceRequest, deleteReference } from '@/lib/server/reference-store';
import { errorResponse } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await addReferenceRequest(request, id));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(_request.url);
    const referenceId = searchParams.get('referenceId') || '';
    if (!referenceId || referenceId.length > 80) return Response.json({ error: 'Reference ID is required.' }, { status: 400 });
    deleteReference(id, referenceId);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
