/***********************
 * Endpoints
 ***********************/
const API_BUILDS_LIST     = '/api/builds';
const API_BUILDS_DISTINCT = '/api/builds/distinct';
const API_BUILDS_DETAIL   = '/api/builds/detail';

/***********************
 * State
 ***********************/
let page = 1;
let limit = 24;

const stateFilters = {
  name: '',
  creator: '',
  type: '',
  min_price: '',
  max_price: '',
};

/***********************
 * Console helpers (API)
 ***********************/
const TAG_API = 'background:#0b6; color:#fff; padding:2px 6px; border-radius:4px;';
function logApiStart(name, url){ console.log(`%cAPI %c${name}`, TAG_API, 'color:#0b6', url); console.time(`[API] ${name}`); }
function logApiEnd(name, status){ console.timeEnd(`[API] ${name}`); console.log(`%cAPI %c${name} ✓`, TAG_API, 'color:#0b6', `status ${status}`); }
function logApiError(name, err){ console.timeEnd(`[API] ${name}`); console.error(`%cAPI %c${name} ✗`, TAG_API, 'color:#c00', err); }

/***********************
 * Utils
 ***********************/
const fmtPrice = (n) => typeof n === 'number' ? `${n.toFixed(2)} €` : `${Number(n||0).toFixed(2)} €`;

function el(tag, attrs={}, children=[]) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}

// Fetch générique avec logs nommés
async function fetchJSONNamed(name, url, opts) {
  logApiStart(name, url);
  const res = await fetch(url, opts);
  logApiEnd(name, res.status);
  if (!res.ok) {
    const txt = await res.text().catch(()=>`HTTP ${res.status}`);
    const err = new Error(txt || `HTTP ${res.status}`);
    logApiError(name, err);
    throw err;
  }
  return res.json();
}

/***********************
 * Lazy DISTINCT loaders
 ***********************/
async function loadDistinctInto(selectEl, field) {
  // déjà chargé ?
  if (selectEl.getAttribute('data-loaded') === 'true') return;

  const current = selectEl.value || '';
  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">⏳ Chargement…</option>`;

  try {
    const url = `${API_BUILDS_DISTINCT}/${encodeURIComponent(field)}`;
    const data = await fetchJSONNamed(`builds.distinct:${field}`, url);
    const values = Array.isArray(data.values) ? data.values : [];
    const opts = [
      `<option value="">— Tous —</option>`,
      ...values.map(v => `<option value="${escapeHtml(v)}"${current === v ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    ].join('');
    selectEl.innerHTML = opts;
    selectEl.setAttribute('data-loaded', 'true');
  } catch (e) {
    selectEl.innerHTML = `<option value="">(Erreur)</option>`;
  } finally {
    selectEl.disabled = false;
  }
}

function attachLazyDistinct(selectEl, field) {
  const trigger = () => loadDistinctInto(selectEl, field);
  selectEl.addEventListener('focus', trigger, { once: false });
  selectEl.addEventListener('click', trigger, { once: false });
}

function escapeHtml(str){
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/***********************
 * Filters UI
 ***********************/
function readFiltersFromUI() {
  stateFilters.name       = document.getElementById('filtreNom').value.trim();
  stateFilters.creator    = document.getElementById('filtreCreateur').value;
  stateFilters.type       = document.getElementById('filtreType').value;
  stateFilters.min_price  = document.getElementById('filtrePrixMin').value.trim();
  stateFilters.max_price  = document.getElementById('filtrePrixMax').value.trim();
}

function resetFilters() {
  document.getElementById('filtreNom').value = '';
  const selC = document.getElementById('filtreCreateur');
  const selT = document.getElementById('filtreType');

  // On garde le lazy: reset visuel mais sans charger
  selC.setAttribute('data-loaded','false');
  selT.setAttribute('data-loaded','false');
  selC.innerHTML = `<option value="">— Cliquer pour charger —</option>`;
  selT.innerHTML = `<option value="">— Cliquer pour charger —</option>`;

  document.getElementById('filtrePrixMin').value = '';
  document.getElementById('filtrePrixMax').value = '';
  readFiltersFromUI();
}

/***********************
 * List fetch & render
 ***********************/
async function loadBuilds() {
  document.getElementById('status').textContent = 'Chargement…';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('summary', '1'); // projection allégée
  if (stateFilters.name)      params.set('name', stateFilters.name);
  if (stateFilters.creator)   params.set('creator', stateFilters.creator);
  if (stateFilters.type)      params.set('type', stateFilters.type);
  if (stateFilters.min_price) params.set('min_price', stateFilters.min_price);
  if (stateFilters.max_price) params.set('max_price', stateFilters.max_price);

  try {
    const url = `${API_BUILDS_LIST}?${params.toString()}`;
    const data = await fetchJSONNamed('builds.list', url);
    renderCards(data.items || []);
    updatePagination({
      page: data.page || 1,
      totalPages: data.totalPages || 1,
      hasPrevPage: !!data.hasPrevPage,
      hasNextPage: !!data.hasNextPage
    });
    const nb = Array.isArray(data.items) ? data.items.length : 0;
    document.getElementById('status').textContent =
      `Page ${data.page}/${data.totalPages} – ${nb} éléments (total ${data.totalDocs})`;
  } catch (e) {
    document.getElementById('status').textContent = 'Erreur: ' + e.message;
  }
}

function renderCards(items) {
  const cont = document.getElementById('cards');
  cont.innerHTML = '';

  if (!items.length) {
    cont.appendChild(el('div', { class: 'muted' }, 'Aucun résultat.'));
    return;
  }

  for (const it of items) {
    const card = el('div', { class: 'card', 'data-id': it._id || '' }, [
      el('div', { class: 'line' }, [
        el('div', { class: 'title' }, it.name || '(sans nom)'),
        el('div', {}, el('span', { class: 'badge' }, it.type || '—'))
      ]),
      el('div', { class: 'line' }, [
        el('div', { class: 'muted' }, `par ${it.creator || '—'}`),
        el('div', { class: 'price' }, fmtPrice(it.total_price_eur || 0))
      ]),
      el('div', { class: 'foot' }, [
        el('button', { class: 'btn-open' }, 'Voir le détail'),
        el('button', { class: 'btn-delete' }, 'Supprimer')
      ])
    ]);

    card.querySelector('.btn-open').addEventListener('click', () => openDetail(it));
    const delBtn = card.querySelector('.btn-delete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!it._id) return alert('Impossible: identifiant manquant');
      if (!confirm(`Confirmer la suppression du build « ${it.name || it._id} » ?`)) return;
      try {
        const url = `/api/builds/${encodeURIComponent(it._id)}`;
        await fetchJSONNamed('builds.delete', url, { method: 'DELETE' });
        // rafraîchir la liste
        loadBuilds();
      } catch (e) {
        alert('Erreur lors de la suppression: ' + e.message);
      }
    });
    cont.appendChild(card);
  }
}

function updatePagination({ page: p, totalPages, hasPrevPage, hasNextPage }) {
  document.getElementById('pageInfo').textContent = `Page ${p}/${totalPages}`;
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  prev.disabled = !hasPrevPage;
  next.disabled = !hasNextPage;
  prev.onclick = () => { page = Math.max(1, p - 1); loadBuilds(); };
  next.onclick = () => { page = p + 1; loadBuilds(); };
}

/***********************
 * Detail fetch & render
 ***********************/
async function openDetail(summary) {
  // On privilégie la récupération par _id si présent
  let url = new URL(API_BUILDS_DETAIL, location.origin);
  if (summary && summary._id) {
    url.searchParams.set('_id', summary._id);
  } else {
    // fallback : name + creator + type + total_price_eur
    url.searchParams.set('name', summary.name || '');
    url.searchParams.set('creator', summary.creator || '');
    url.searchParams.set('type', summary.type || '');
    url.searchParams.set('total_price_eur', String(summary.total_price_eur ?? ''));
  }

  try {
    const data = await fetchJSONNamed('builds.detail', url.toString());
    renderDetail(data);
    showModal();
  } catch (e) {
    // Fallback côté front si _id custom ne passe pas
    try {
      const u = new URL(API_BUILDS_DETAIL, location.origin);
      u.searchParams.set('name', summary.name || '');
      u.searchParams.set('creator', summary.creator || '');
      u.searchParams.set('type', summary.type || '');
      u.searchParams.set('total_price_eur', String(summary.total_price_eur ?? ''));
      const data = await fetchJSONNamed('builds.detail(fallback)', u.toString());
      renderDetail(data);
      showModal();
    } catch (e2) {
      alert('Impossible de charger le détail: ' + e2.message);
    }
  }
}

function renderDetail(doc) {
  const title = document.getElementById('detailTitle');
  const meta  = document.getElementById('detailMeta');
  const body  = document.getElementById('detailBody');
  const total = document.getElementById('detailTotal');

  title.textContent = doc.name || '(Build)';
  meta.textContent  = `Créateur: ${doc.creator || '—'} • Type: ${doc.type || '—'}`;
  total.textContent = `Total: ${fmtPrice(Number(doc.total_price_eur || 0))}`;

  body.innerHTML = '';

  const grid = el('div', { class: 'detail-grid' });

  // bandeau résumé
  grid.appendChild(el('div', { class: 'summary' }, [
    el('div', { class: 'kpi' }, [ el('span', { class: 'lbl' }, 'Nom'),  el('span', { class: 'val' }, doc.name || '—') ]),
    el('div', { class: 'kpi' }, [ el('span', { class: 'lbl' }, 'Créateur'), el('span', { class: 'val' }, doc.creator || '—') ]),
    el('div', { class: 'kpi' }, [ el('span', { class: 'lbl' }, 'Type'), el('span', { class: 'val' }, doc.type || '—') ]),
    el('div', { class: 'kpi' }, [ el('span', { class: 'lbl' }, 'Prix'), el('span', { class: 'val' }, fmtPrice(Number(doc.total_price_eur || 0))) ])
  ]));

  // Items : doc.items = { category: { id: { qty, item } } }
  const items = doc.items || {};
  const cats = Object.keys(items);

  if (!cats.length) {
    grid.appendChild(el('div', { class: 'muted', style:'grid-column:span 12' }, 'Aucun composant enregistré.'));
  } else {
    for (const cat of cats) {
      const byId = items[cat] || {};
      const subIds = Object.keys(byId);
      if (!subIds.length) continue;

      for (const id of subIds) {
        const slot = byId[id];
        const qty  = slot?.qty || 1;
        const item = slot?.item || {};
        const label = [item.brand, item.model, item.name].filter(Boolean).join(' ') || id;

        const price = (item.price && (typeof item.price === 'number' ? item.price
                            : (typeof item.price?.eur === 'number' ? item.price.eur
                              : (item.price?.currency === 'EUR' ? item.price.value : 0)))) || 0;

        const card = el('div', { class: 'comp-card' }, [
          el('div', { class: 'comp-head' }, [
            el('div', { class: 'comp-title' }, label),
            el('span', { class: 'tag' }, cat)
          ]),
          el('div', { class: 'comp-body' }, [
            rowKV('Marque', item.brand),
            rowKV('Modèle', item.model),
            rowKV('Nom', item.name),
            rowKV('Quantité', qty),
            rowKV('Prix unitaire', fmtPrice(Number(price))),
            rowKV('Sous-total', fmtPrice(Number(price) * Number(qty))),
            item.url ? rowKV('Lien', linkify(item.url)) : null,
          ].filter(Boolean)),
          el('div', { class: 'comp-foot' }, el('span', { class: 'badge' }, `${fmtPrice(Number(price) * Number(qty))}`))
        ]);

        grid.appendChild(card);
      }
    }
  }

  body.appendChild(grid);
}

function rowKV(k, v){
  const val = (v === null || v === undefined || v === '') ? '—' : v;
  const row = el('div', { class: 'comp-row' }, [
    el('div', { class: 'key' }, k),
    el('div', { class: 'val' }, (typeof val === 'string' ? val : String(val)))
  ]);
  return row;
}

function linkify(url) {
  const a = document.createElement('a');
  a.href = url; a.textContent = url; a.target = '_blank'; a.rel = 'noopener';
  return a.outerHTML;
}

/***********************
 * Modal controls
 ***********************/
function showModal(){
  const m = document.getElementById('detailModal');
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden', 'false');
}
function hideModal(){
  const m = document.getElementById('detailModal');
  m.classList.add('hidden');
  m.setAttribute('aria-hidden', 'true');
}

/***********************
 * Init
 ***********************/
function bindUI(){
  // attacher le lazy DISTINCT sur les selects
  attachLazyDistinct(document.getElementById('filtreCreateur'), 'creator');
  attachLazyDistinct(document.getElementById('filtreType'), 'type');

  // taille page
  const sel = document.getElementById('pageSize');
  limit = parseInt(sel.value || '24', 10) || 24;
  sel.addEventListener('change', () => {
    limit = parseInt(sel.value || '24', 10) || 24;
    page = 1;
    loadBuilds();
  });

  // boutons
  document.getElementById('btnAppliquer').addEventListener('click', () => {
    readFiltersFromUI();
    page = 1;
    loadBuilds();
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    resetFilters();
    page = 1;
    loadBuilds();
  });

  // Entrées directes
  document.getElementById('filtreNom').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ readFiltersFromUI(); page=1; loadBuilds(); }
  });

  document.getElementById('closeDetail').addEventListener('click', hideModal);
  document.getElementById('detailModal').addEventListener('click', (e)=>{
    if (e.target.id === 'detailModal') hideModal();
  });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideModal(); });
}

window.addEventListener('DOMContentLoaded', async () => {
  resetFilters();   // met les placeholders "— Cliquer pour charger —"
  bindUI();         // attache les handlers (lazy load inclus)
  loadBuilds();     // charge la liste sans need de remplir les selects
});
