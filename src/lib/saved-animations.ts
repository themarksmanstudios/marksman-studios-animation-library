const KEY = 'marksman-animation-library:saved';
const listeners = new Set<() => void>();

function notify() { listeners.forEach(listener => listener()); }

export function subscribeSaved(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  listeners.add(listener);
  window.addEventListener('storage', notify);
  return () => { listeners.delete(listener); window.removeEventListener('storage', notify); };
}

export function getSavedSnapshot() {
  try { return localStorage.getItem(KEY) || '[]'; }
  catch { return '[]'; }
}

export function getServerSavedSnapshot() { return '[]'; }

export function toggleSaved(id: string) {
  const current: string[] = JSON.parse(getSavedSnapshot());
  const next = current.includes(id) ? current.filter(saved => saved !== id) : [...current, id];
  localStorage.setItem(KEY, JSON.stringify(next));
  notify();
  return next.includes(id);
}
