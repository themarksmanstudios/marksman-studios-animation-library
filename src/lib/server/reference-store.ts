import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { updateItems } from './animation-store';
import { HttpError, readBody } from './http';
import { text } from './normalize';
import type { AnimationReference } from '@/types/animation';

function referenceDirectory() {
  const directory = process.env.ANIMATION_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(directory, 'references');
}

function addReference(animationId: string, reference: AnimationReference) {
  return updateItems(items => {
    const item = items.find(candidate => candidate.id === animationId);
    if (!item) throw new HttpError(404, 'Animation not found.');
    item.references = [...(item.references || []), reference];
    item.updatedAt = new Date().toISOString();
    return { items, result: item };
  });
}

export async function addReferenceRequest(request: Request, animationId: string) {
  const type = request.headers.get('content-type') || '';
  const referenceId = randomUUID();
  let reference: AnimationReference;
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose an image or video to upload.');
    if (!file.size || file.size > 8 * 1024 * 1024) throw new HttpError(400, 'Reference files must be between 1 byte and 8 MB.');
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    };
    const extension = extensions[file.type];
    if (!extension) throw new HttpError(400, 'Use a JPG, PNG, WebP, GIF, MP4, WebM, or MOV reference.');
    const title = text(form.get('title') || file.name, 180);
    if (!title) throw new HttpError(400, 'Reference title is required.');
    fs.mkdirSync(referenceDirectory(), { recursive: true });
    fs.writeFileSync(path.join(referenceDirectory(), `${referenceId}${extension}`), Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
    reference = { id: referenceId, title, url: `/api/references/${referenceId}`, kind: file.type.startsWith('video/') ? 'video' : 'image', createdAt: new Date().toISOString() };
  } else {
    const payload = await readBody(request);
    const url = text(payload.url, 2000);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new HttpError(400, 'Enter a valid reference URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'Reference links must use HTTP or HTTPS.');
    const title = text(payload.title, 180) || parsed.hostname;
    reference = { id: referenceId, title, url: parsed.toString(), kind: 'link', createdAt: new Date().toISOString() };
  }
  try { return addReference(animationId, reference); }
  catch (error) {
    if (reference.kind !== 'link' && fs.existsSync(referenceDirectory())) {
      const file = fs.readdirSync(referenceDirectory()).find(name => name.startsWith(`${referenceId}.`));
      if (file) fs.rmSync(path.join(referenceDirectory(), file), { force: true });
    }
    throw error;
  }
}

export function deleteReference(animationId: string, referenceId: string) {
  const deleted = updateItems(items => {
    const item = items.find(candidate => candidate.id === animationId);
    if (!item) throw new HttpError(404, 'Animation not found.');
    const reference = (item.references || []).find(candidate => candidate.id === referenceId);
    if (!reference) throw new HttpError(404, 'Reference not found.');
    item.references = item.references.filter(candidate => candidate.id !== referenceId);
    item.updatedAt = new Date().toISOString();
    return { items, result: reference };
  });
  if (deleted.kind !== 'link' && deleted.url.startsWith('/api/references/')) {
    const directory = referenceDirectory();
    if (fs.existsSync(directory)) {
      const file = fs.readdirSync(directory).find(name => name.startsWith(`${path.basename(deleted.url)}.`));
      if (file) fs.rmSync(path.resolve(directory, file), { force: true });
    }
  }
}
