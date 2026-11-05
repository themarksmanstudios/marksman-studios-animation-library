'use client';

import { useEffect, useRef, useState } from 'react';
import { UploadSimple, FolderOpen, FloppyDisk } from '@phosphor-icons/react';

type Settings = { rootDirectory: string; templateFile: string; hdriFile: string };

export function ProductionSetup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [root, setRoot] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const hdriInput = useRef<HTMLInputElement>(null);

  useEffect(() => { void fetch('/api/production/settings', { cache: 'no-store' }).then(response => response.json()).then((value: Settings) => { setSettings(value); setRoot(value.rootDirectory); }).catch(() => setMessage('Could not load production settings.')); }, []);

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Production setup failed.');
    return value;
  }

  async function saveRoot() {
    setBusy(true); setMessage('');
    try { const value = await request('/api/production/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rootDirectory: root }) }); setSettings(value); setRoot(value.rootDirectory); setMessage('Master folder saved for this computer.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save folder.'); }
    finally { setBusy(false); }
  }

  async function uploadScene(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('');
    try { const body = new FormData(); body.set('scene', file); const value = await request('/api/production/settings', { method: 'POST', body }); setSettings(value); setMessage('Blender scene template uploaded. New workspaces and renders will use it.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not upload scene template.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function uploadHdri(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('');
    try { const body = new FormData(); body.set('hdri', file); const value = await request('/api/production/settings', { method: 'POST', body }); setSettings(value); setMessage('HDRI uploaded. Blender will use it for GIF preview lighting.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not upload HDRI.'); }
    finally { setBusy(false); if (hdriInput.current) hdriInput.current.value = ''; }
  }

  return <section className="production-setup" aria-label="Master production folder setup">
    <div className="production-setup-heading"><div><span className="eyebrow">BLENDER WORKSPACE</span><h2>Master folder &amp; render assets</h2><p>Choose this computer’s local root folder, upload the shared Blender scene and optional HDRI, then generate each workspace from its animation detail panel.</p></div></div>
    <div className="production-setup-controls"><label className="master-folder-field"><span><FolderOpen size={15} /> Master animation folder</span><input value={root} onChange={event => setRoot(event.target.value)} placeholder="D:\\Studio\\Motion Capture" spellCheck={false} aria-label="Master animation folder path" /></label>
      <button className="button secondary" disabled={busy || !root.trim() || root === settings?.rootDirectory} onClick={() => void saveRoot()}><FloppyDisk size={15} /> Save folder</button>
      <input ref={input} type="file" accept=".blend,application/octet-stream" hidden onChange={event => void uploadScene(event.currentTarget.files?.[0])} />
      <button className="button secondary" disabled={busy} onClick={() => input.current?.click()}><UploadSimple size={15} /> Upload .blend scene</button>
      <input ref={hdriInput} type="file" accept=".hdr,.exr" hidden onChange={event => void uploadHdri(event.currentTarget.files?.[0])} />
      <button className="button secondary" disabled={busy} onClick={() => hdriInput.current?.click()}><UploadSimple size={15} /> Upload HDRI</button>
    </div>
    <div className="production-setup-footer"><span>{settings?.templateFile ? `Scene: ${settings.templateFile}` : 'No Blender scene uploaded.'}</span><span>{settings?.hdriFile ? `HDRI: ${settings.hdriFile}` : 'No HDRI uploaded.'}</span>{message && <span role="status">{message}</span>}</div>
    <small>Enter a folder path available to this computer. The .blend supplies the character and World setup. An uploaded HDRI replaces only the image on the scene’s connected Environment Texture node; node links, rotation, strength, and scene color management stay as authored.</small>
  </section>;
}
