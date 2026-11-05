import fs from 'node:fs';
import path from 'node:path';
import { readProductionProject } from '@/lib/server/production-store';
import { errorResponse, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; path: string[] }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id, path: segments } = await context.params;
    const project = readProductionProject(id);
    if (!project) throw new HttpError(404, 'Production workspace not found.');
    const file = path.resolve(project.directory, ...segments);
    const relative = path.relative(path.resolve(project.directory), file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new HttpError(400, 'Invalid production asset path.');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Production asset not found.');
    const extension = path.extname(file).toLowerCase();
    const contentType: Record<string, string> = {
      '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
      '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp4': 'video/mp4', '.webm': 'video/webm',
    };
    const inline = ['.gif', '.png', '.jpg', '.webp', '.mp4', '.webm'].includes(extension);
    return new Response(fs.readFileSync(file), {
      headers: {
        'Content-Type': contentType[extension] || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${path.basename(file).replace(/[\r\n"]+/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return errorResponse(error); }
}
