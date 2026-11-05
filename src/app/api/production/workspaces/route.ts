export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  return Response.json({ error: 'Generate a workspace from an individual animation detail panel.' }, { status: 410 });
}
