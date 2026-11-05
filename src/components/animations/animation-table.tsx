import { DotsThree, Plus, Sparkle } from '@phosphor-icons/react';
import type { Animation } from '@/types/animation';

function dateLabel(value: string) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
}

interface Props {
  items: Animation[];
  total: number;
  loading: boolean;
  error: string;
  onEdit: (item: Animation) => void;
  onNew: () => void;
}

export function AnimationTable({ items, total, loading, error, onEdit, onNew }: Props) {
  return <>
    <div className="table-wrap" aria-busy={loading}>
      <table>
        <thead><tr><th scope="col">ANIMATION</th><th scope="col">CATEGORY</th><th scope="col">STATUS</th><th scope="col">OWNER</th><th scope="col">PRIORITY</th><th scope="col">DUE DATE</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{items.map(item => (
          <tr key={item.id}>
            <td><div className="animation-name"><span className="row-art">{(item.title || '?')[0].toUpperCase()}</span><div><strong>{item.title}</strong><small>{item.description || 'No brief added'}</small></div></div></td>
            <td>{item.category || '—'}</td>
            <td><span className={`status-pill ${item.status.toLowerCase().replaceAll(' ', '-')}`}><i />{item.status}</span></td>
            <td>{item.owner ? <span className="owner-cell"><span className="owner-avatar">{initials(item.owner)}</span>{item.owner}</span> : <span className="muted">Unassigned</span>}</td>
            <td><span className={`priority ${item.priority.toLowerCase()}`}><i />{item.priority}</span></td>
            <td className="date-cell">{dateLabel(item.dueDate)}</td>
            <td><button className="row-menu" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}><DotsThree size={20} weight="bold" /></button></td>
          </tr>
        ))}</tbody>
      </table>
      {error && <p className="load-error" role="alert">{error} Use Refresh library to retry.</p>}
      {!items.length && !error && <div className="empty-state">
        <div className="empty-art"><Sparkle size={24} weight="duotone" /></div>
        <h3>{loading ? 'Loading your library…' : total ? 'No matching animations' : 'Your library is ready'}</h3>
        {!loading && <><p>{total ? 'Try another search or status filter.' : 'Add your first animation or import the studio catalogue to get started.'}</p>{!total && <button className="button primary" onClick={onNew}><Plus size={16} /> Add an animation</button>}</>}
      </div>}
    </div>
    <footer className="table-footer"><span>Showing {items.length} of {total} animation{total === 1 ? '' : 's'}</span><span>Changes are saved on this device</span></footer>
  </>;
}
