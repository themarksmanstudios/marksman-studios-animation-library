import { getAnimationById } from '@/lib/server/animation-store';
import { createProductionProject, readProductionProject } from '@/lib/server/production-store';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!getAnimationById(id)) throw new HttpError(404, 'Animation not found.');
    return Response.json(readProductionProject(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const animation = getAnimationById(id);
    if (!animation) throw new HttpError(404, 'Animation not found.');
    return Response.json(createProductionProject(animation), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
