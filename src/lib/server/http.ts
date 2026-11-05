export const MAX_BODY = 12 * 1024 * 1024;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) {
    throw new HttpError(413, 'Request is too large (12 MB maximum).');
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large (12 MB maximum).');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return data as Record<string, unknown>;
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  return Response.json({ error: 'Unable to complete the request. Check the server logs.' }, { status: 500 });
}
