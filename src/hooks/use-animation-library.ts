'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, readImportFile } from '@/lib/api-client';
import type { Animation, AnimationInput, ImportResult } from '@/types/animation';

export function useAnimationLibrary() {
  const [items, setItems] = useState<Animation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestVersion = useRef(0);

  const notify = useCallback((message: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ message, error });
    timer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const load = useCallback((signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    return api<Animation[]>('/api/animations', { signal }).then(data => {
      if (signal?.aborted || version !== requestVersion.current) return;
      setItems(data);
      setLoadError('');
    }).catch(error => {
      if (signal?.aborted || version !== requestVersion.current) return;
      const message = error instanceof Error ? error.message : 'Unable to load the library.';
      setLoadError(message);
      notify(message, true);
    }).finally(() => {
      if (!signal?.aborted && version === requestVersion.current) setLoading(false);
    });
  }, [notify]);

  const refresh = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function save(input: AnimationInput, id?: string) {
    await api<Animation>(id ? `/api/animations/${encodeURIComponent(id)}` : '/api/animations', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
    await refresh();
    notify(id ? 'Animation updated.' : 'Animation added.');
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      // Base64 expands XLSX payloads by roughly one third.
      const limit = /\.xlsx$/i.test(file.name) ? 8 * 1024 * 1024 : 11 * 1024 * 1024;
      if (file.size > limit) throw new Error('This file is too large. Import a smaller catalogue.');
      const data = await readImportFile(file);
      const result = await api<ImportResult>('/api/import', {
        method: 'POST', body: JSON.stringify({ filename: file.name, data }),
      });
      await refresh();
      notify(`Imported ${result.imported} animation${result.imported === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Import failed.', true); }
    finally { setImporting(false); }
  }

  return { items, loading, loadError, importing, notice, refresh, save, importFile };
}
