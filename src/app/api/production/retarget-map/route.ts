import { readMixamoRetargetMap, saveMixamoRetargetMap } from '@/lib/server/production-store';
import { errorResponse, readBody } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try { return Response.json({ mapping: readMixamoRetargetMap() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await readBody(request);
    const mapping = saveMixamoRetargetMap(body.mapping);
    return Response.json({ mapping });
  } catch (error) { return errorResponse(error); }
}
