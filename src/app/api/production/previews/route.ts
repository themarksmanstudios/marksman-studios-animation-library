import { listCompletedProductionPreviews } from '@/lib/server/production-store';
import { errorResponse } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return Response.json(listCompletedProductionPreviews(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
