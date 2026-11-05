'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { Animation, AnimationReference } from '@/types/animation';
import type { ProductionProject } from '@/types/production';
import { X, BookmarkSimple, FolderPlus, Play, ArrowRight, Images, Video, ArrowSquareOut, LinkSimple, FilmSlate, Plus, UploadSimple } from '@phosphor-icons/react';

interface Props {
  item: Animation;
  saved: boolean;
  onClose: () => void;
  onSave: () => void;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
}

function safeImageQuery(text: string) { return encodeURIComponent(`${text} movement reference`); }

export function AnimationDetail({ item, saved, onClose, onSave, onEdit, onRefresh }: Props) {
  const [tab, setTab] = useState<'overview' | 'preview' | 'references'>('overview');
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [production, setProduction] = useState<ProductionProject | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const query = safeImageQuery(`${item.title} ${item.region}`);
  const completedGif = production && ['complete', 'partial'].includes(production.status) && production.outputs?.some(output => output.toLowerCase().endsWith('.glb'))
    ? production.outputs?.find(output => output.toLowerCase().endsWith('.gif'))
    : undefined;

  useEffect(() => {
    if (tab === 'preview' && !completedGif) setTab('overview');
  }, [tab, completedGif]);

  useEffect(() => {
    let alive = true;
    const refreshProduction = async () => {
      try {
        const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/production`, { cache: 'no-store' });
        if (response.ok && alive) setProduction(await response.json());
      } catch { /* Production workspace is optional until first prepared. */ }
    };
    void refreshProduction();
    return () => { alive = false; };
  }, [item.id]);

  useEffect(() => {
    if (!production || !['queued', 'running'].includes(production.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/production`, { cache: 'no-store' });
        if (response.ok) setProduction(await response.json());
      } catch { /* Keep the last known job status visible. */ }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [item.id, production]);

  async function productionAction(action: 'prepare' | 'run') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/production${action === 'run' ? '/run' : ''}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The Blender production action failed.');
      setProduction(result);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'The Blender production action failed.'); }
    finally { setBusy(false); }
  }

  async function addLink() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/references`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link, title }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this reference.');
      setLink(''); setTitle(''); await onRefresh();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not save this reference.'); }
    finally { setBusy(false); }
  }

  async function addFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('title', title || file.name);
      const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/references`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not upload this reference.');
      setTitle(''); await onRefresh();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not upload this reference.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function removeReference(reference: AnimationReference) {
    if (!window.confirm(`Remove ${reference.title} from this animation?`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/animations/${encodeURIComponent(item.id)}/references?referenceId=${encodeURIComponent(reference.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove this reference.');
      await onRefresh();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not remove this reference.'); }
    finally { setBusy(false); }
  }

  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <header className="detail-header"><div className="detail-kicker">ANIMATION DETAILS</div><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={17} /></button></header>
      <div className="detail-heading"><div className="detail-id">{item.id}<span>{item.collection}</span></div><h2 id="detailTitle">{item.title}</h2><div className="detail-subtitle">{item.subcategory || item.category}<span>?</span>{item.region || 'Universal'}</div><div className="detail-actions"><button className={`button secondary${saved ? ' saved-detail' : ''}`} onClick={onSave}>{saved ? <><BookmarkSimple size={15} weight="fill" /> Saved</> : <><BookmarkSimple size={15} /> Save animation</>}</button><button className="button secondary" onClick={onEdit}>Edit details</button></div></div>
      <div className="detail-tabs"><button className={tab === 'overview' ? 'selected' : ''} onClick={() => setTab('overview')}>Overview</button>{completedGif && <button className={tab === 'preview' ? 'selected' : ''} onClick={() => setTab('preview')}>Preview</button>}<button className={tab === 'references' ? 'selected' : ''} onClick={() => setTab('references')}>References <span>{item.references.length}</span></button></div>
      {tab === 'overview' ? <div className="detail-content">
        <div className="metadata-grid">
          <div><span>Category</span><strong>{item.category || '?'}</strong></div>
          <div><span>Region / scope</span><strong>{item.region || 'Universal'}</strong></div>
          <div><span>Subcategory</span><strong>{item.subcategory || '?'}</strong></div>
          <label><span>Production status</span><select value={item.status} onChange={async event => { await fetch(`/api/animations/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, status: event.target.value }) }); await onRefresh(); }}>{['Planned', 'Captured', 'Cleaning', 'Retargeting', 'Review', 'Published'].map(status => <option key={status}>{status}</option>)}</select></label>
          <div className="wide-field"><span>Actors / performers</span><strong>{item.actors || 'Not assigned'}</strong></div>
        </div>
        <div className="detail-field"><div className="detail-field-label">Search tags</div><div className="detail-tags">{item.tags.map(tag => <span key={tag}>#{tag}</span>)}</div></div>
        <div className="detail-field"><div className="detail-field-label">Profile hashtags <button onClick={() => { void navigator.clipboard.writeText(item.hashtags); }}>Copy all</button></div><p className="hashtag-block">{item.hashtags || 'No profile hashtags added.'}</p></div>
        <div className="detail-field"><div className="detail-field-label">Capture notes</div><p className="capture-notes">{item.captureNotes || 'No special capture notes. Add reference clips or images to guide the performer and cleanup team.'}</p></div>
        {item.description && <div className="detail-field"><div className="detail-field-label">Production brief</div><p className="capture-notes">{item.description}</p></div>}
        <section className="production-panel" aria-label="Blender production workspace">
          <div className="detail-field-label">Blender production</div>
          <p>Use the uploaded Blender scene and its character for the GIF and GLB. If the scene has no animation action, put this animation's captured motion file in 02-motion-source; Blender will retarget it onto the scene character.</p>
          {!production ? <button className="button secondary" disabled={busy} onClick={() => void productionAction('prepare')}><FolderPlus size={15} /> Generate folder structure</button> : <>
            <div className="production-status"><span className={`status-dot ${production.status}`} /> {production.status}</div>
            <code className="production-path">{production.directory}</code>
            {production.sourceFiles?.length ? <details className="production-source-list"><summary>Blender input sources ({production.sourceFiles.length})</summary><ul>{production.sourceFiles.map(source => <li key={`${source.role}:${source.path}`}><strong>{source.role}</strong><code>{source.path}</code></li>)}</ul></details> : null}
            <div className="production-actions">
              <button className="button secondary" disabled={busy || ['queued', 'running'].includes(production.status)} onClick={() => void productionAction('run')}><Play size={15} /> Prepare Blender job</button>
              <button className="button secondary" disabled={busy} onClick={() => void productionAction('prepare')}>Refresh folder structure</button>
            </div>
            {production.outputs?.length ? <ul className="production-outputs">{production.outputs.map(output => <li key={output}><a href={assetUrl(production, output)}>{output.split(/[\\/]/).pop()}</a></li>)}</ul> : null}
            {production.missingInputs?.length ? <p className="production-hint">Still needed: {production.missingInputs.join(', ')}</p> : null}
            {production.lastError ? <p className="form-error">{production.lastError}</p> : null}
          </>}
          <small>Place each Unreal, Mixamo, or generalized rig's animated file in its matching input folder. Blender uses the shared Mixamo bone map configured from Add bone names on the dashboard and exports a GLB with baked motion.</small>
        </section>
        {completedGif && production && <section className="inline-animation-preview" aria-label="Completed animation preview">
          <div className="detail-field-label"><span>Animation preview</span><button onClick={() => setTab('preview')}>Open preview tab <ArrowRight size={14} /></button></div>
          <Image className="detail-preview-gif" src={`${assetUrl(production, completedGif)}?v=${encodeURIComponent(production.updatedAt)}`} width={1080} height={720} unoptimized alt={`${item.title} completed animation preview`} />
        </section>}
        <button className="button reference-cta" onClick={() => setTab('references')}>Open reference desk <ArrowRight size={15} /></button>
      </div> : tab === 'preview' && completedGif && production ? <div className="detail-content animation-preview-content">
        <div className="preview-heading"><div><h3>Animation preview</h3><p>Rendered from the completed Blender production job.</p></div><span className="preview-ready-badge">Ready</span></div>
        <Image className="detail-preview-gif" src={`${assetUrl(production, completedGif)}?v=${encodeURIComponent(production.updatedAt)}`} width={1080} height={720} unoptimized alt={`${item.title} completed animation preview`} />
        <a className="button secondary preview-download" href={assetUrl(production, completedGif)} download><FilmSlate size={15} /> Download GIF</a>
      </div> : <div className="detail-content reference-content">
        <h3>Reference desk</h3><p className="reference-intro">Attach verified images and clips, or search for reference material for this exact movement.</p>
        <div className="reference-searches"><a href={`https://www.google.com/search?tbm=isch&q=${query}`} target="_blank" rel="noreferrer"><Images size={15} /> Search images <ArrowSquareOut size={13} /></a><a href={`https://www.youtube.com/results?search_query=${query}`} target="_blank" rel="noreferrer"><Video size={15} /> Search videos <ArrowSquareOut size={13} /></a></div>
        <div className="reference-list-heading">Saved references <span>({item.references.length})</span></div>
        {!!item.references.length && <div className="reference-list">{item.references.map(reference => <article className="reference-item" key={reference.id}>
          {reference.kind === 'image' ? <a href={reference.url} target="_blank" rel="noreferrer" className="reference-preview"><img src={reference.url} alt={reference.title} /></a> : reference.kind === 'video' ? <a href={reference.url} target="_blank" rel="noreferrer" className="reference-preview"><video src={reference.url} preload="metadata" /></a> : <span className="reference-link-icon"><LinkSimple size={19} /></span>}
          <div className="reference-item-title"><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a><small>{reference.kind}</small></div><button onClick={() => void removeReference(reference)} disabled={busy} aria-label={`Remove ${reference.title}`}><X size={15} /></button>
        </article>)}</div>}
        {!item.references.length && <div className="empty-references"><span><FilmSlate size={24} /></span><strong>No saved references yet</strong><p>Attach a clip or add an image to guide the performer and cleanup team.</p></div>}
        <div className="add-reference"><label className="reference-input-label">Add a reference link<input value={link} onChange={event => setLink(event.target.value)} placeholder="Paste an image or video URL" inputMode="url" /></label><label className="reference-input-label">Reference name<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Performer movement example" /></label><button className="button primary add-link-button" onClick={() => void addLink()} disabled={busy || !link.trim()}><Plus size={15} /> Add link</button>
          <div className="upload-divider"><span>or upload a studio reference</span></div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden onChange={event => void addFile(event.currentTarget.files?.[0])} /><button className="button secondary full" disabled={busy} onClick={() => fileInput.current?.click()}><UploadSimple size={15} /> Upload image or video</button><small className="upload-note">JPG, PNG, WebP, GIF, MP4, WebM or MOV | up to 8 MB</small>
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
      </div>}
    </section>
  </div>;
}

function assetUrl(project: ProductionProject, file: string) {
  const relative = file.slice(project.directory.length).replace(/^[\\/]+/, '');
  const encoded = relative.split(/[\\/]+/).map(encodeURIComponent).join('/');
  return `/api/animations/${encodeURIComponent(project.animationId)}/production/assets/${encoded}`;
}
