import { getProductionSettings, saveProductionRoot, storeHdri, storeSceneTemplate } from '@/lib/server/production-store';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() { return Response.json(getProductionSettings(), { headers: { 'Cache-Control': 'no-store' } }); }

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { rootDirectory?: unknown };
    if (typeof body.rootDirectory !== 'string') throw new HttpError(400, 'Enter a master folder path.');
    return Response.json(saveProductionRoot(body.rootDirectory));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const scene = data.get('scene');
    if (scene instanceof File) return Response.json(storeSceneTemplate(scene.name, Buffer.from(await scene.arrayBuffer())));
    const hdri = data.get('hdri');
    if (hdri instanceof File) return Response.json(storeHdri(hdri.name, Buffer.from(await hdri.arrayBuffer())));
    throw new HttpError(400, 'Select a Blender .blend scene file or an .hdr/.exr HDRI file.');
  } catch (error) { return errorResponse(error); }
}
