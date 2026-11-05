'use client';

import { useEffect, useRef, useState } from 'react';
import { MIXAMO_BONES, mixamoSourceName } from '@/lib/retarget/mixamo-bones';

export function MixamoRetargetDialog({ onClose }: { onClose: () => void }) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/production/retarget-map', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the shared Mixamo map.');
        if (active) setMapping(result.mapping || {});
      })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load the shared Mixamo map.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/production/retarget-map', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the shared Mixamo map.');
      setMapping(result.mapping || {});
      setMessage('Shared map saved. All Mixamo Blender jobs will use it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the shared Mixamo map.'); }
    finally { setSaving(false); }
  }

  async function upload(file?: File) {
    if (!file) return;
    setMessage('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'mapping' in parsed
        ? (parsed as { mapping: unknown }).mapping : parsed;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The JSON file must contain a source-to-target bone map.');
      const next: Record<string, string> = {};
      const allowed = new Set(MIXAMO_BONES.map(mixamoSourceName));
      for (const [source, target] of Object.entries(value)) {
        if (!allowed.has(source)) throw new Error(`Unsupported Mixamo source bone: ${source}`);
        if (typeof target !== 'string') throw new Error(`Target for ${source} must be a bone name string.`);
        next[source] = target;
      }
      setMapping(next);
      setMessage('Map loaded from file. Save to make it available to all animations.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read this mapping file.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  return <div className="retarget-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="retarget-dialog" role="dialog" aria-modal="true" aria-labelledby="retargetTitle">
      <header className="retarget-dialog-header"><div><span className="eyebrow">GLOBAL BLENDER SETUP</span><h2 id="retargetTitle">Mixamo bone names</h2><p>Shared by all animation workspaces. Map the Mixamo source bones to the matching bones on your character rig.</p></div><button className="icon-button" onClick={onClose} aria-label="Close bone map">×</button></header>
      <div className="retarget-dialog-tools"><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void upload(event.currentTarget.files?.[0])} /><button className="button secondary" onClick={() => fileInput.current?.click()} disabled={loading || saving}>↑ Upload map JSON</button><span>JSON format: source bone name → target character bone name</span></div>
      <div className="retarget-dialog-table-wrap">
        <div className="retarget-table-head"><span>YOUR CHARACTER · TARGET</span><span>MIXAMO · SOURCE</span></div>
        {MIXAMO_BONES.map(bone => {
          const source = mixamoSourceName(bone);
          return <label className="retarget-row" key={source}>
            <input aria-label={`Target character bone for ${source}`} value={mapping[source] || ''} disabled={loading || saving} onChange={event => setMapping(current => ({ ...current, [source]: event.target.value }))} placeholder="Type target bone name" />
            <code>{source}</code>
          </label>;
        })}
        {loading && <div className="retarget-loading">Loading shared map…</div>}
      </div>
      <footer className="retarget-dialog-footer"><span className="retarget-map-count">{Object.values(mapping).filter(Boolean).length} target bones mapped</span>{message && <span role="status" className="retarget-map-message">{message}</span>}<button className="button primary" onClick={() => void save()} disabled={loading || saving}>{saving ? 'Saving…' : 'Save global bone map'}</button></footer>
    </section>
  </div>;
}
