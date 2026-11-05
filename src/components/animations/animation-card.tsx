'use client';

import type { Animation, AnimationStatus } from '@/types/animation';
import { STATUSES } from '@/types/animation';
import { BookmarkSimple, UsersThree, ImageSquare } from '@phosphor-icons/react';

interface AnimationCardProps {
  item: Animation;
  previewGif?: string;
  saved: boolean;
  onOpen: (item: Animation) => void;
  onSave: (id: string) => void;
  onStatus: (item: Animation, status: AnimationStatus) => void;
}

export function AnimationCard({ item, previewGif, saved, onOpen, onSave, onStatus }: AnimationCardProps) {
  const preview = previewGif || '/animation-previews/studio-robot-preview.png';
  return <article className="animation-card">
    <button className="card-art has-preview" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}>
      <img className={`card-preview-image ${previewGif ? 'is-gif-preview' : 'is-robot-preview'}`} src={preview} alt={previewGif ? `${item.title} completed animation preview` : 'White studio robot in a T-pose on a gray background'} />
      <span className="collection-label">{item.collection || 'Animation collection'}</span><span className="animation-id">{item.id}</span>
    </button>
    <div className="card-body">
      <div className="card-title-row"><button className="card-title" onClick={() => onOpen(item)}>{item.title}</button><button className={`save-button${saved ? ' saved' : ''}`} onClick={() => onSave(item.id)} aria-label={saved ? `Remove ${item.title} from saved` : `Save ${item.title}`} title={saved ? 'Remove from saved' : 'Save animation'}><BookmarkSimple size={17} weight={saved ? 'fill' : 'regular'} /></button></div>
      <div className="card-subtitle">{item.subcategory || item.category}<span>·</span>{item.region || 'Universal'}</div>
      {item.actors && <div className="actor-line"><UsersThree size={14} /> {item.actors}</div>}
      <div className="tag-list">{item.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}{item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}</div>
      <div className="card-footer"><span className={`reference-count${item.references.length ? ' has-references' : ''}`}><ImageSquare size={15} />{item.references.length} references</span><select aria-label={`Update status for ${item.title}`} value={item.status} onChange={event => onStatus(item, event.target.value as AnimationStatus)} onClick={event => event.stopPropagation()}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
    </div>
  </article>;
}
