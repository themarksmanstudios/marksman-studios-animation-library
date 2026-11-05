'use client';

import { useMemo, useRef, useState, useSyncExternalStore, useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { useAnimationLibrary } from '@/hooks/use-animation-library';
import { STATUSES, type Animation, type StatusFilter } from '@/types/animation';
import { getSavedSnapshot, getServerSavedSnapshot, subscribeSaved, toggleSaved } from '@/lib/saved-animations';
import { AnimationCard } from './animation-card';
import { AnimationDetail } from './animation-detail';
import { AnimationDialog } from './animation-dialog';
import { LibraryStats } from './library-stats';
import { ProductionSetup } from './production-setup';
import { MixamoRetargetDialog } from './mixamo-retarget-dialog';
import { MagnifyingGlass, SquaresFour, Rows, ArrowsLeftRight, Export, Plus, UploadSimple, SlidersHorizontal, BookmarkSimple, Images, House, Gear, FilmSlate } from '@phosphor-icons/react';

type MobileTab = 'library' | 'saved' | 'references' | 'settings';

export function AnimationLibrary() {
  const { items, loading, loadError, importing, notice, refresh, save, importFile } = useAnimationLibrary();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('All');
  const [collection, setCollection] = useState('');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [referenceOnly, setReferenceOnly] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('library');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: Animation | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [retargetMapOpen, setRetargetMapOpen] = useState(false);
  const [productionPreviews, setProductionPreviews] = useState<Record<string, string>>({});
  const savedSnapshot = useSyncExternalStore(subscribeSaved, getSavedSnapshot, getServerSavedSnapshot);
  const saved = useMemo(() => new Set(JSON.parse(savedSnapshot) as string[]), [savedSnapshot]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const loadProductionPreviews = async () => {
      try {
        const response = await fetch('/api/production/previews', { cache: 'no-store' });
        if (response.ok && active) setProductionPreviews(await response.json());
      } catch { /* Keep the default card art if production previews are unavailable. */ }
    };
    void loadProductionPreviews();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadProductionPreviews(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach(item => counts.set(item.collection || 'Unsorted', (counts.get(item.collection || 'Unsorted') || 0) + 1));
    return [...counts].map(([name, count]) => ({ name, count }));
  }, [items]);
  const categories = useMemo(() => [...new Set(items.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const regions = useMemo(() => [...new Set(items.map(item => item.region).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const reviewCount = items.filter(item => item.status === 'Review').length;
  const withReferences = items.filter(item => item.references.length).length;
  const filtered = items.filter(item =>
    (status === 'All' || item.status === status) &&
    (!collection || item.collection === collection) &&
    (!category || item.category === category) &&
    (!region || item.region === region) &&
    (!savedOnly || saved.has(item.id)) &&
    (!referenceOnly || item.references.length > 0) &&
    `${item.title} ${item.category} ${item.subcategory} ${item.collection} ${item.region} ${item.actors} ${item.tags.join(' ')} ${item.hashtags}`.toLowerCase().includes(query.toLowerCase()));
  const openNew = () => setEditor({ item: null });
  const detail = items.find(item => item.id === detailId) || null;

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('#catalogue-search')?.focus(); }
      else if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName || '')) { event.preventDefault(); document.querySelector<HTMLInputElement>('#catalogue-search')?.focus(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  async function exportCatalogue() {
    setExporting(true);
    try {
      const response = await fetch('/api/export', { cache: 'no-store' });
      if (!response.ok) throw new Error('Catalogue export failed.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Marksman_Animation_Catalogue.csv'; anchor.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  async function setItemStatus(item: Animation, nextStatus: Animation['status']) {
    await save({ ...item, status: nextStatus }, item.id);
  }

  function selectMobileTab(tab: MobileTab) {
    setMobileTab(tab);
    setSavedOnly(tab === 'saved');
    setReferenceOnly(tab === 'references');
  }

  return <>
    <div className={`app-shell mobile-tab-${mobileTab}`}>
      <Sidebar savedCount={saved.size} totalCount={items.length} collections={collections} categories={categories} selectedCollection={collection} selectedCategory={category} savedOnly={savedOnly} onCollection={setCollection} onCategory={setCategory} onSaved={setSavedOnly} />
      <main className="main-content" id="library">
        <header className="topbar"><label className="global-search"><MagnifyingGlass size={18} /><input id="catalogue-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search animations, tags, regions…" aria-label="Search animations, tags, and regions" /><kbd>⌘ K</kbd></label><button className="view-toggle" title={`Switch to ${view === 'grid' ? 'list' : 'grid'} view`} aria-label={`Switch to ${view === 'grid' ? 'list' : 'grid'} view`} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <Rows size={17} /> : <SquaresFour size={17} />}</button><div className="topbar-workspace"><strong>Production dashboard</strong><span>Marksman Studios · Internal</span></div><div className="user-avatar">M</div></header>
        <section className="page-heading">
          <div><div className="eyebrow">COMPANY <span>/</span> <b>ANIMATION PRODUCTION</b></div><h1>Animation production</h1><p className="intro">A studio workspace for motion capture, references, and production status.</p></div>
          <div className="heading-actions">
            <button className="button secondary" onClick={() => setRetargetMapOpen(true)}><ArrowsLeftRight size={15} /> Bone map</button>
            <button className="button secondary" onClick={() => void exportCatalogue()} disabled={exporting}><Export size={15} /> {exporting ? 'Exporting…' : 'Export catalogue'}</button>
            <button className="button primary" onClick={openNew}><Plus size={16} /> Add animation</button>
            <button className="button secondary import-action" onClick={() => fileInput.current?.click()} disabled={importing}><UploadSimple size={15} /> {importing ? 'Importing…' : 'Import'}</button>
            <input ref={fileInput} type="file" accept=".xlsx,.csv,.json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} />
          </div>
        </section>
        <div className="mobile-review-summary"><div><span className="summary-overline">WORK QUEUE</span><strong>{reviewCount} animations need review</strong><small>Across {items.length.toLocaleString()} tracked movements</small></div><span className="review-indicator"><span /> Active</span></div>
        <div className="desktop-overview"><LibraryStats items={items} /></div>
        <section className="settings-section"><div className="mobile-section-heading"><span className="summary-overline">WORKSPACE</span><h2>Blender production</h2><p>Manage your shared motion capture project folder.</p></div><ProductionSetup /></section>
        <section className="catalogue">
          <div className="catalogue-heading"><div><span className="summary-overline">ANIMATION LIBRARY</span><h2>{mobileTab === 'saved' ? 'Saved animations' : mobileTab === 'references' ? 'Reference library' : 'All animations'}</h2></div><span className="catalogue-total">{filtered.length} of {items.length}</span></div>
          <div className="filter-bar"><span className="filter-label"><SlidersHorizontal size={15} /> Filter</span>
            <select value={category} onChange={event => { setCategory(event.target.value); setCollection(''); setSavedOnly(false); }} aria-label="Filter by category"><option value="">All animations</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
            <select value={collection} onChange={event => { setCollection(event.target.value); setCategory(''); setSavedOnly(false); }} aria-label="Filter by collection"><option value="">All collections</option>{collections.map(value => <option key={value.name}>{value.name}</option>)}</select>
            <select value={region} onChange={event => setRegion(event.target.value)} aria-label="Filter by region"><option value="">All regions</option>{regions.map(value => <option key={value}>{value}</option>)}</select>
            <select value={status} onChange={event => setStatus(event.target.value as StatusFilter)} aria-label="Filter by status"><option value="All">All statuses</option>{STATUSES.map(value => <option key={value}>{value}</option>)}</select>
          </div>
          {loadError && <p className="load-error" role="alert">{loadError} Use Refresh to retry.</p>}
          {loading && !items.length ? <div className="loading-state">Loading animation catalogue…</div> : filtered.length ? <div className={`animation-grid${view === 'list' ? ' list-view' : ''}`}>{filtered.map(item => <AnimationCard key={item.id} item={item} previewGif={productionPreviews[item.id]} saved={saved.has(item.id)} onOpen={item => setDetailId(item.id)} onSave={toggleSaved} onStatus={setItemStatus} />)}</div> : <div className="empty-catalogue"><h2>No animations match these filters</h2><button onClick={() => { setQuery(''); setStatus('All'); setCategory(''); setCollection(''); setRegion(''); setSavedOnly(false); setReferenceOnly(false); selectMobileTab('library'); }}>Clear filters</button></div>}
        </section>
        <footer className="page-footer">MARKSMAN STUDIOS <span>·</span> INTERNAL MOTION CAPTURE DASHBOARD <span className="footer-showing">Showing {filtered.length} of {items.length} animations</span></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Primary navigation">
      <button className={mobileTab === 'library' ? 'active' : ''} onClick={() => selectMobileTab('library')}><House size={19} weight={mobileTab === 'library' ? 'fill' : 'regular'} /><span>Library</span></button>
      <button className={mobileTab === 'saved' ? 'active' : ''} onClick={() => selectMobileTab('saved')}><BookmarkSimple size={19} weight={mobileTab === 'saved' ? 'fill' : 'regular'} /><span>Saved</span></button>
      <button className={mobileTab === 'references' ? 'active' : ''} onClick={() => selectMobileTab('references')}><Images size={19} weight={mobileTab === 'references' ? 'fill' : 'regular'} /><span>References</span><small>{withReferences}</small></button>
      <button className={mobileTab === 'settings' ? 'active' : ''} onClick={() => selectMobileTab('settings')}><Gear size={19} weight={mobileTab === 'settings' ? 'fill' : 'regular'} /><span>Settings</span></button>
    </nav>
    <div className={`toast${notice ? ' show' : ''}${notice?.error ? ' error' : ''}`} role="status" aria-live="polite">{notice?.message}</div>
    {detail && <AnimationDetail key={detail.id} item={detail} saved={saved.has(detail.id)} onClose={() => setDetailId(null)} onSave={() => toggleSaved(detail.id)} onEdit={() => { setEditor({ item: detail }); setDetailId(null); }} onRefresh={refresh} />}
    {editor && <AnimationDialog item={editor.item} onClose={() => setEditor(null)} onSave={save} />}
    {retargetMapOpen && <MixamoRetargetDialog onClose={() => setRetargetMapOpen(false)} />}
  </>;
}
