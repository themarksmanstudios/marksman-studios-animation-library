import type { Animation } from '@/types/animation';
import { SquaresFour, GlobeHemisphereWest, Images, SpinnerGap, ArrowUpRight } from '@phosphor-icons/react';

export function LibraryStats({ items }: { items: Animation[] }) {
  const cards = [
    { label: 'Total animations', count: items.length, icon: SquaresFour, detail: 'In your catalogue' },
    { label: 'Indian collection', count: items.filter(item => item.collection === 'Indian collection').length, icon: GlobeHemisphereWest, detail: 'Regional & cultural motion' },
    { label: 'Saved references', count: items.reduce((sum, item) => sum + item.references.length, 0), icon: Images, detail: 'Images or video attached' },
    { label: 'In production', count: items.filter(item => ['Captured', 'Cleaning', 'Retargeting'].includes(item.status)).length, icon: SpinnerGap, detail: 'Active capture workflow' },
  ];
  return <section className="stats-grid" aria-label="Library overview">{cards.map((card, index) => {
    const Icon = card.icon;
    return <article className="stat-card" key={card.label}><div className={`stat-icon stat-icon-${index}`}><Icon size={17} weight="regular" /></div><ArrowUpRight className="stat-arrow" size={16} /><strong>{card.count}</strong><b>{card.label}</b><small>{card.detail}</small></article>;
  })}</section>;
}
