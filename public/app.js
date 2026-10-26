const $ = selector => document.querySelector(selector);
const state = { items: [], query: '', status: 'All' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateLabel = value => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Something went wrong.');
  return data;
}
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—'; }
function render() {
  const items = state.items;
  $('#totalStat').textContent = items.length;
  $('#productionStat').textContent = items.filter(x => x.status === 'In Progress').length;
  $('#reviewStat').textContent = items.filter(x => x.status === 'Review').length;
  $('#approvedStat').textContent = items.filter(x => x.status === 'Approved').length;
  $('#navCount').textContent = items.length;
  const filtered = items.filter(item => (state.status === 'All' || item.status === state.status) && `${item.title} ${item.category} ${item.owner} ${item.tags}`.toLowerCase().includes(state.query.toLowerCase()));
  $('#resultCount').textContent = filtered.length;
  $('#footerCount').textContent = `Showing ${filtered.length} of ${items.length} animation${items.length === 1 ? '' : 's'}`;
  $('#emptyState').hidden = filtered.length > 0;
  $('#emptyState').querySelector('h3').textContent = items.length ? 'No matching animations' : 'Your library is ready';
  $('#emptyState').querySelector('p').textContent = items.length ? 'Try another search or status filter.' : 'Add your first animation or import the studio catalogue to get started.';
  $('#emptyState').querySelector('button').hidden = items.length > 0;
  $('#animationRows').innerHTML = filtered.map(item => `<tr>
    <td><div class="animation-name"><span class="row-art">${esc((item.title || '?')[0].toUpperCase())}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.description || 'No brief added')}</small></div></div></td>
    <td>${esc(item.category || '—')}</td><td><span class="status-pill ${item.status.toLowerCase().replaceAll(' ', '-')}"><i></i>${esc(item.status)}</span></td>
    <td>${item.owner ? `<span class="owner-cell"><span class="owner-avatar">${esc(initials(item.owner))}</span>${esc(item.owner)}</span>` : '<span class="muted">Unassigned</span>'}</td>
    <td><span class="priority ${item.priority.toLowerCase()}"><i></i>${esc(item.priority)}</span></td><td class="date-cell">${dateLabel(item.dueDate)}</td>
    <td><button class="row-menu" data-edit="${esc(item.id)}" aria-label="Edit ${esc(item.title)}">···</button></td></tr>`).join('');
}
async function refresh() { try { state.items = await api('/api/animations'); render(); } catch (error) { toast(error.message, true); } }
const dialog = $('#animationDialog');
function openForm(item = null) {
  const form = $('#animationForm'); form.reset(); form.elements.id.value = item?.id || '';
  $('#dialogTitle').textContent = item ? 'Edit animation' : 'New animation';
  if (item) for (const key of ['title', 'category', 'owner', 'status', 'priority', 'dueDate', 'tags', 'description']) form.elements[key].value = item[key] || '';
  dialog.showModal(); form.elements.title.focus();
}
$('#newButton').addEventListener('click', () => openForm());
$('#emptyNewButton').addEventListener('click', () => openForm());
$('#closeDialog').addEventListener('click', () => dialog.close());
$('#cancelDialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('#animationForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const id = data.id; delete data.id;
  try { await api(id ? `/api/animations/${encodeURIComponent(id)}` : '/api/animations', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }); dialog.close(); await refresh(); toast(id ? 'Animation updated.' : 'Animation added.'); }
  catch (error) { toast(error.message, true); }
});
$('#animationRows').addEventListener('click', event => {
  const button = event.target.closest('[data-edit]'); if (!button) return;
  const item = state.items.find(x => x.id === button.dataset.edit); if (item) openForm(item);
});
$('#searchInput').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#statusFilter').addEventListener('change', event => { state.status = event.target.value; render(); });
document.querySelectorAll('[data-filter]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); state.status = event.currentTarget.dataset.filter; $('#statusFilter').value = state.status;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === event.currentTarget)); render();
}));
$('.nav-item.active').addEventListener('click', event => { event.preventDefault(); state.status = 'All'; $('#statusFilter').value = 'All'; document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === event.currentTarget)); render(); });
$('#refreshButton').addEventListener('click', refresh);
$('#importButton').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const isExcel = /\.xlsx?$/i.test(file.name);
    const data = isExcel ? await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }) : await file.text();
    const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ filename: file.name, data }) });
    await refresh(); toast(`Imported ${result.imported} animation${result.imported === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped` : ''}.`);
  } catch (error) { toast(error.message, true); } finally { event.target.value = ''; }
});
$('#today').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
refresh();
