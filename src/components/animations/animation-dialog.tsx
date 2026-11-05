'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STATUSES, PRIORITIES, type Animation, type AnimationInput } from '@/types/animation';

interface Props {
  item: Animation | null;
  onClose: () => void;
  onSave: (data: AnimationInput, id?: string) => Promise<void>;
}

export function AnimationDialog({ item, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    title.current?.focus();
    return () => element?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData) as unknown as Omit<AnimationInput, 'tags'> & { tags: string };
    const input: AnimationInput = { ...data, tags: data.tags.split(/[;,\n]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean) };
    setSaving(true);
    setError('');
    try { await onSave(input, item?.id); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to save animation.'); }
    finally { setSaving(false); }
  }

  return (
    <dialog ref={dialog} aria-labelledby="dialogTitle" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form id="animationForm" onSubmit={submit}>
        <div className="dialog-heading"><div><div className="eyebrow">LIBRARY RECORD</div><h2 id="dialogTitle">{item ? 'Edit animation' : 'New animation'}</h2></div><button className="icon-button close-button" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button></div>
        <fieldset disabled={saving}>
          <label className="field full">Animation title <span>*</span><input ref={title} name="title" required maxLength={160} defaultValue={item?.title} placeholder="e.g. Namaste casual" /></label>
          <div className="form-grid">
            <label className="field">Collection<input name="collection" maxLength={100} defaultValue={item?.collection} placeholder="Indian collection" /></label>
            <label className="field">Category<input name="category" maxLength={100} defaultValue={item?.category} placeholder="Greetings and gestures" /></label>
            <label className="field">Subcategory<input name="subcategory" maxLength={100} defaultValue={item?.subcategory} placeholder="Greetings" /></label>
            <label className="field">Region / scope<input name="region" maxLength={120} defaultValue={item?.region} placeholder="India, Kerala, Universal…" /></label>
            <label className="field">Actors / performers<input name="actors" maxLength={240} defaultValue={item?.actors} placeholder="Performer count, roles, or cast" /></label>
            <label className="field">Owner<input name="owner" maxLength={100} defaultValue={item?.owner} placeholder="Assign a teammate" /></label>
            <label className="field">Status<select name="status" defaultValue={item?.status || 'Planned'}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
            <label className="field">Priority<select name="priority" defaultValue={item?.priority || 'Normal'}>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></label>
            <label className="field">Due date<input name="dueDate" type="date" defaultValue={item?.dueDate} /></label>
            <label className="field full">Search tags<input name="tags" maxLength={800} defaultValue={item?.tags.join('; ')} placeholder="greetings; social; namaste" /></label>
            <label className="field full">Profile hashtags<input name="hashtags" maxLength={600} defaultValue={item?.hashtags} placeholder="#MarksmanStudios #MotionCapture" /></label>
          </div>
          <label className="field full">Capture notes<textarea name="captureNotes" rows={3} maxLength={1200} defaultValue={item?.captureNotes} placeholder="Add performer or cleanup guidance…" /></label>
          <label className="field full">Production brief<textarea name="description" rows={3} maxLength={1200} defaultValue={item?.description} placeholder="Add a production brief…" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">{saving ? 'Saving…' : 'Save animation'}</button></div>
        </fieldset>
      </form>
    </dialog>
  );
}
