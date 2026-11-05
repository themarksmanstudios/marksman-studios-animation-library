import { getAnimationById } from '@/lib/server/animation-store';
import { enqueueBlenderJob } from '@/lib/server/production-store';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!getAnimationById(id)) throw new HttpError(404, 'Animation not found.');
    return Response.json(enqueueBlenderJob(id), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
