import fs from 'node:fs';
import path from 'node:path';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[\da-f-]{36}$/i.test(id)) throw new HttpError(404, 'Reference not found.');
    const directory = path.join(process.env.ANIMATION_DATA_DIR || path.join(process.cwd(), 'data'), 'references');
    const file = fs.readdirSync(directory).find(name => name.startsWith(`${id}.`));
    if (!file) throw new HttpError(404, 'Reference not found.');
    const extension = path.extname(file).toLowerCase();
    if (!MIME[extension]) throw new HttpError(404, 'Reference not found.');
    return new Response(fs.readFileSync(path.join(directory, file)), {
      headers: { 'Content-Type': MIME[extension], 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
    });
  } catch (error) { return errorResponse(error); }
}
