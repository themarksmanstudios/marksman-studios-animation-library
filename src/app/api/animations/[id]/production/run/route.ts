import { getAnimationById } from '@/lib/server/animation-store';
import { enqueueBlenderJob } from '@/lib/server/production-store';
import type { ProductionAction } from '@/types/production';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!getAnimationById(id)) throw new HttpError(404, 'Animation not found.');
    const body = await request.json().catch(() => ({})) as { action?: string; width?: number; height?: number };
    const action = body.action;
    if (!['gif', 'glb', 'fbx'].includes(action || '')) throw new HttpError(400, 'Choose a GIF, GLB, or head-removed FBX process.');
    let resolution: { width: number; height: number } | undefined;
    if (action === 'gif') {
      const width = Number(body.width);
      const height = Number(body.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 120 || height < 120 || width > 1920 || height > 1920) {
        throw new HttpError(400, 'GIF width and height must be whole pixels between 120 and 1920.');
      }
      resolution = { width, height };
    }
    return Response.json(enqueueBlenderJob(id, action as ProductionAction, resolution), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
