import Link from 'next/link';
import { SquaresFour, BookmarkSimple, Sparkle } from '@phosphor-icons/react';

interface SidebarProps {
  savedCount: number;
  totalCount: number;
  collections: { name: string; count: number }[];
  categories: string[];
  selectedCollection: string;
  selectedCategory: string;
  savedOnly: boolean;
  onCollection: (value: string) => void;
  onCategory: (value: string) => void;
  onSaved: (savedOnly: boolean) => void;
}

export function Sidebar({ savedCount, totalCount, collections, categories, selectedCollection, selectedCategory, savedOnly, onCollection, onCategory, onSaved }: SidebarProps) {
  return <aside className="sidebar">
    <Link href="/" className="brand" aria-label="Marksman Animation Library home">
      <span className="brand-mark"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 21V8l6 7 4-7v13M18 9v12m0-16v.2" /></svg></span>
      <span><strong>MARKSMAN</strong><small>ANIMATION LIBRARY</small></span>
    </Link>
    <div className="side-scroll">
      <div className="side-label">INTERNAL DASHBOARD</div>
      <button className={`side-link${!savedOnly && !selectedCollection && !selectedCategory ? ' active' : ''}`} onClick={() => { onSaved(false); onCollection(''); onCategory(''); }}><SquaresFour className="side-glyph" size={17} />All animations<span className="side-count">{totalCount}</span></button>
      <button className={`side-link${savedOnly ? ' active' : ''}`} onClick={() => onSaved(true)}><BookmarkSimple className="side-glyph" size={17} />Saved<span className="side-count">{savedCount}</span></button>
      <div className="side-label collection-label">COLLECTIONS</div>
      <button className={`side-link collection-link${!selectedCollection ? ' active' : ''}`} onClick={() => { onSaved(false); onCollection(''); onCategory(''); }}><span className="collection-dot" />All collections</button>
      {collections.map((collection, index) => <button key={collection.name} className={`side-link collection-link${selectedCollection === collection.name ? ' active' : ''}`} onClick={() => { onSaved(false); onCollection(collection.name); onCategory(''); }}><span className={`collection-dot tint-${index % 4}`} />{collection.name}<span className="side-count">{collection.count}</span></button>)}
      <div className="side-label category-label">CATEGORIES</div>
      <div className="category-list">{categories.map(category => <button key={category} className={`category-link${selectedCategory === category ? ' active' : ''}`} onClick={() => { onSaved(false); onCollection(''); onCategory(selectedCategory === category ? '' : category); }}><span>#</span>{category}</button>)}</div>
    </div>
    <div className="reference-desk"><Sparkle size={16} /><strong>Reference desk</strong><small>Keep each animation, source references, and production status together.</small></div>
  </aside>;
}
