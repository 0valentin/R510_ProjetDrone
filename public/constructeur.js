// ===============================
// Endpoints
// ===============================
const API_CATEGORIES = '/api/categories';
const API_PARTS      = '/api/parts';
const API_DISTINCT   = '/api/distinct';
const API_RANGE      = '/api/range';
const API_SPEC_KEYS  = '/api/spec-keys';
const API_COMP_KEYS  = '/api/compat-keys';
const API_FIELD_KEYS = '/api/field-keys';

// Fallback catégories
const FALLBACK_CATEGORIES = [
  'antennas','batteries','buzzers','chargers','escs','flight_controllers',
  'fpv_cameras','frames','goggles','gps_modules','motors','propellers',
  'radios','receivers','vtx'
];

const PREFERRED_FIELDS = ['brand','model','name','variant','cells','kv','weight_g','price','category'];

// Panier
const selectedBuild = Object.create(null);
// cache par combinaison category + filter
const cache = Object.create(null);
// filtre courant (envoyé tel quel)
let currentFilter = null;

// ✅ Toutes les catégories connues pour afficher un récap “complet” (même vides)
let ALL_CATEGORIES = [];

// ===============================
// Utils
// ===============================
function escapeHtml(str){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toLabel(doc){ const p=[]; if(doc.brand)p.push(doc.brand); if(doc.model)p.push(doc.model); if(doc.name&&doc.name!==doc.model)p.push(doc.name); return p.join(' ')||(doc._id??'(élément)');}
function ensureCatMap(cat){ if(!selectedBuild[cat]) selectedBuild[cat]=Object.create(null); return selectedBuild[cat]; }
function sanitizeQty(q){ const n=Math.max(0, parseInt(String(q||'0'),10)||0); return n; }
function upsertSelection(cat,item,qty){ const map=ensureCatMap(cat); const id=item._id; const n=sanitizeQty(qty); if(!id) return; if(n<=0){ delete map[id]; return; } map[id]={ _id:id, label:toLabel(item), brand:item.brand??'', model:item.model??'', qty:n }; }
function removeSelection(cat,id){ const map=ensureCatMap(cat); delete map[id]; }
function clearCategorySelection(cat){ selectedBuild[cat]=Object.create(null); }

// ✅ Normalise et trie la liste de catégories
function normalizeCategories(arr){
  return Array.from(new Set(
    (arr||[]).filter(x => typeof x === 'string' && x.trim()).map(s => s.trim())
  )).sort();
}

// ✅ Prépare des “placeholders” vides pour toutes les catégories
function ensureAllCategoryPlaceholders(cats){
  for (const c of cats) if (!selectedBuild[c]) selectedBuild[c] = Object.create(null);
}

function pickColumns(docs){
  const set=new Set(); for(const d of docs) Object.keys(d).forEach(k=>set.add(k));
  set.delete('_id');
  const pref=PREFERRED_FIELDS.filter(k=>set.has(k));
  const others=[...set].filter(k=>!pref.includes(k));
  return ['_id', ...pref, ...others].slice(0, 8);
}

// Rendu lisible objets/arrays
function renderValue(val){
  if (val===null||val===undefined) return '';
  if (typeof val==='string'){
    if (/^https?:\/\/\S+/i.test(val)) { const s=escapeHtml(val); return `<a href="${s}" target="_blank" rel="noopener">${s}</a>`; }
    return escapeHtml(val);
  }
  if (typeof val==='number'||typeof val==='boolean') return String(val);
  if (Array.isArray(val)) return `<ul class="kv-list">${val.map(v=>`<li>${renderValue(v)}</li>`).join('')}</ul>`;
  if (typeof val==='object'){
    const items = Object.keys(val).map(k=>`<li><span class="kv-key">${escapeHtml(k)}</span>: <span class="kv-val">${renderValue(val[k])}</span></li>`).join('');
    return `<ul class="kv-list">${items}</ul>`;
  }
  return escapeHtml(String(val));
}

// ===============================
// Fetch
// ===============================
async function fetchCategories(){ try{ const r=await fetch(API_CATEGORIES); if(!r.ok) throw 0; const arr=await r.json(); return Array.isArray(arr)&&arr.length?arr:FALLBACK_CATEGORIES; }catch{ return FALLBACK_CATEGORIES; } }
async function fetchDistinct(category, fields){ const url=new URL(API_DISTINCT,location.origin); url.searchParams.set('category',category); url.searchParams.set('fields',fields.join(',')); const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchRange(category, field){ const url=new URL(API_RANGE,location.origin); url.searchParams.set('category',category); url.searchParams.set('field',field); const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchSpecKeys(category){ const url=new URL(API_SPEC_KEYS,location.origin); url.searchParams.set('category',category); const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchCompatKeys(category){ const url=new URL(API_COMP_KEYS,location.origin); url.searchParams.set('category',category); const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchFieldKeys(category){ const url=new URL(API_FIELD_KEYS,location.origin); url.searchParams.set('category',category); const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchParts(category, filter){
  if(!category) return [];
  const key=category+'::'+JSON.stringify(filter||{});
  if(cache[key]) return cache[key];
  const url=new URL(API_PARTS,location.origin);
  url.searchParams.set('category',category);
  if(filter) url.searchParams.set('filter',JSON.stringify(filter));
  const r=await fetch(url);
  if(!r.ok) throw new Error('HTTP '+r.status);
  const data=await r.json();
  cache[key]=Array.isArray(data)?data:[];
  return cache[key];
}

// ===============================
// Render
// ===============================
function renderCategories(categories){
  const sel=document.getElementById('selectCategory');
  sel.innerHTML='<option value="">-- Choisir une catégorie --</option>';
  categories.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
}

// ✅ Récap : toujours toutes les catégories (même vides)
function renderBuild(){
  const ul=document.getElementById('buildList');
  ul.innerHTML='';

  const cats = (ALL_CATEGORIES && ALL_CATEGORIES.length)
    ? ALL_CATEGORIES
    : Object.keys(selectedBuild).sort();

  for(const cat of cats){
    const map = selectedBuild[cat] || {};
    const items = Object.values(map);

    const header = document.createElement('li');
    header.innerHTML = `<strong>${escapeHtml(cat)}</strong>`;
    ul.appendChild(header);

    if(!items.length){
      const li = document.createElement('li');
      li.className = 'build-empty';
      li.textContent = '— (aucun article)';
      ul.appendChild(li);
      continue;
    }

    for(const it of items){
      const li=document.createElement('li'); li.className='build-line';
      li.innerHTML=`<span class="build-label">${escapeHtml(it.label)}</span>
        <input type="number" class="qty-mini" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it._id)}" min="0" step="1" value="${it.qty}" />
        <button type="button" class="btn-remove" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it._id)}">Retirer</button>`;
      ul.appendChild(li);
    }
  }
}

function renderPartsTable(category, docs){
  const section=document.getElementById('partsSection');
  const thead=document.querySelector('#partsTable thead');
  const tbody=document.querySelector('#partsTable tbody');

  if(!docs||!docs.length){ section.style.display='none'; thead.innerHTML=''; tbody.innerHTML=''; return; }

  const cols=pickColumns(docs);
  thead.innerHTML = `<tr><th>Qté</th>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}<th>Action</th></tr>`;
  tbody.innerHTML='';

  for(const d of docs){
    const tr=document.createElement('tr');
    tr.dataset.category=category;
    tr.dataset.item=encodeURIComponent(JSON.stringify(d));
    tr.dataset.id=d._id??'';

    const qtyTd=document.createElement('td');
    qtyTd.innerHTML=`<input type="number" class="qty" min="0" step="1" value="0" style="width:70px" />`;
    tr.appendChild(qtyTd);

    for(const c of cols){
      const td=document.createElement('td');
      td.innerHTML = renderValue(d[c]);
      tr.appendChild(td);
    }

    const act=document.createElement('td');
    act.innerHTML=`<button type="button" class="btn-add">Ajouter</button>`;
    tr.appendChild(act);

    tbody.appendChild(tr);
  }
  section.style.display='';
}

// ===============================
// Modal helpers (checkbox/sections)
// ===============================
function mkId(prefix, val){ return prefix + '__' + String(val).replace(/\W+/g,'_'); }
function checkboxList(container, values){
  container.innerHTML = '';
  values.forEach(v=>{
    const id = mkId(container.id, typeof v === 'object' ? JSON.stringify(v) : v);
    const wrapper = document.createElement('label');
    wrapper.className = 'check';
    wrapper.innerHTML = `
      <input type="checkbox" data-json='${encodeURIComponent(JSON.stringify(v))}' id="${id}">
      <span>${escapeHtml(String(v))}</span>
    `;
    container.appendChild(wrapper);
  });
}
function getCheckedRawValues(container){
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(i => { try{ return JSON.parse(decodeURIComponent(i.getAttribute('data-json')||'null')); }catch{ return i.value; } })
    .filter(v => v !== null && v !== undefined);
}

function makeValueBox(fieldPath, values, title){
  const section = document.createElement('details');
  section.className = 'filter-section';
  section.open = false;
  const labelId = mkId('grid', fieldPath);
  section.innerHTML = `
    <summary><span class="kv-key">${escapeHtml(title || fieldPath)}</span></summary>
    <div class="check-grid" id="${labelId}"></div>
  `;
  const box = section.querySelector('.check-grid');
  checkboxList(box, values.filter(v => v !== null && v !== undefined));
  section.dataset.field = fieldPath;
  section.dataset.kind = 'in';
  return section;
}

function makeRangeSection(fieldPath, min, max, title){
  const section = document.createElement('details');
  section.className = 'filter-section';
  section.open = true;
  section.innerHTML = `
    <summary><span class="kv-key">${escapeHtml(title || fieldPath)}</span></summary>
    <div class="range-row" style="padding:10px;">
      <label>Min <input type="number" class="range-min" step="any" placeholder="${min ?? ''}"></label>
      <label>Max <input type="number" class="range-max" step="any" placeholder="${max ?? ''}"></label>
    </div>
  `;
  section.dataset.field = fieldPath;
  section.dataset.kind = 'range';
  return section;
}

async function populateSpecsAndCompat(category){
  const specsBox = document.getElementById('specsBox');
  const compatBox = document.getElementById('compatBox');
  specsBox.innerHTML = '<div class="muted">Chargement…</div>';
  compatBox.innerHTML = '<div class="muted">Chargement…</div>';

  try {
    const [specKeys, compatKeys] = await Promise.all([ fetchSpecKeys(category), fetchCompatKeys(category) ]);
    const specValuesMap = await fetchDistinct(category, specKeys.map(k => `specs.${k}`));
    const compatValuesMap = await fetchDistinct(category, compatKeys.map(k => `compat.${k}`));

    specsBox.innerHTML = '';
    for (const k of specKeys) {
      const vals = (specValuesMap[`specs.${k}`] || []);
      if (!vals.length) continue;
      specsBox.appendChild(makeValueBox(`specs.${k}`, vals, `specs.${k}`));
    }

    compatBox.innerHTML = '';
    for (const k of compatKeys) {
      const vals = (compatValuesMap[`compat.${k}`] || []);
      if (!vals.length) continue;
      compatBox.appendChild(makeValueBox(`compat.${k}`, vals, `compat.${k}`));
    }

    if (!specsBox.children.length) specsBox.innerHTML = '<div class="muted">Aucune clé specs disponible</div>';
    if (!compatBox.children.length) compatBox.innerHTML = '<div class="muted">Aucune clé compat disponible</div>';
  } catch (e) {
    console.error(e);
    specsBox.innerHTML = '<div class="muted">Erreur</div>';
    compatBox.innerHTML = '<div class="muted">Erreur</div>';
  }
}

async function populateGeneralFields(category){
  const select = document.getElementById('generalFieldSelect');
  select.innerHTML = '<option value="">(choisir)</option>';

  try {
    const { scalar = [], numeric = [] } = await fetchFieldKeys(category);

    if (scalar.length) {
      const g = document.createElement('optgroup'); g.label = 'Texte / Booléen';
      scalar.forEach(f => { const o=document.createElement('option'); o.value=f; o.textContent=f; g.appendChild(o); });
      select.appendChild(g);
    }
    if (numeric.length) {
      const g = document.createElement('optgroup'); g.label = 'Numérique';
      numeric.forEach(f => { const o=document.createElement('option'); o.value=f; o.textContent=f; g.appendChild(o); });
      select.appendChild(g);
    }
  } catch (e) {
    console.error(e);
  }
}

async function addGeneralField(){
  const category = document.getElementById('selectCategory').value;
  if (!category) return;
  const select = document.getElementById('generalFieldSelect');
  const field = select.value.trim();
  if (!field) return;

  const box = document.getElementById('generalBox');

  if ([...box.querySelectorAll('.filter-section')].some(s => s.dataset.field === field)) return;

  const isNumeric = [...select.selectedOptions].some(o => o.parentElement?.label === 'Numérique');

  try {
    if (isNumeric) {
      const { min, max } = await fetchRange(category, field);
      box.appendChild(makeRangeSection(field, min, max, field));
    } else {
      const out = await fetchDistinct(category, [field]);
      const values = (out[field] || []).filter(v => v !== null && v !== undefined);
      box.appendChild(makeValueBox(field, values, field));
    }
    select.selectedIndex = 0;
  } catch (e) {
    console.error(e);
  }
}

// ===============================
// Modal open/apply/reset
// ===============================
async function openModal(){
  const category = document.getElementById('selectCategory').value;
  if (!category) { alert('Choisis d’abord une catégorie.'); return; }

  try {
    const [distincts, priceRange, warrantyRange] = await Promise.all([
      fetchDistinct(category, ['brand','price.currency']),
      fetchRange(category, 'price.eur'),
      fetchRange(category, 'warranty_months')
    ]);

    // Brand
    checkboxList(document.getElementById('brandBox'), (distincts['brand']||[]).sort());

    // Currency
    const curSel = document.getElementById('priceCurrency');
    curSel.innerHTML = '<option value="">(toutes)</option>';
    (distincts['price.currency']||[]).forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; curSel.appendChild(o); });

    // Ranges
    document.getElementById('priceMin').placeholder = priceRange.min ?? '';
    document.getElementById('priceMax').placeholder = priceRange.max ?? '';
    document.getElementById('warrantyMin').placeholder = warrantyRange.min ?? '';
    document.getElementById('warrantyMax').placeholder = warrantyRange.max ?? '';

    // Specs & compat
    await populateSpecsAndCompat(category);

    // Champs généraux
    await populateGeneralFields(category);

    // Vide les sections ajoutées précédemment
    document.getElementById('generalBox').innerHTML = '';
  } catch (e) {
    console.error(e);
  }

  const m = document.getElementById('filtersModal');
  m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
}
function closeModal(){ const m=document.getElementById('filtersModal'); m.classList.add('hidden'); m.setAttribute('aria-hidden','true'); }

function applyFilters(){
  const category = document.getElementById('selectCategory').value;
  if (!category) { closeModal(); return; }

  const filter = {};

  // Brand
  const brands = getCheckedRawValues(document.getElementById('brandBox'));
  if (brands.length) filter['brand'] = { $in: brands };

  // Price
  const cur = document.getElementById('priceCurrency').value.trim();
  if (cur) filter['price.currency'] = cur;
  const minEur = parseFloat(document.getElementById('priceMin').value);
  const maxEur = parseFloat(document.getElementById('priceMax').value);
  if (!Number.isNaN(minEur) || !Number.isNaN(maxEur)) {
    filter['price.eur'] = {};
    if (!Number.isNaN(minEur)) filter['price.eur'].$gte = minEur;
    if (!Number.isNaN(maxEur)) filter['price.eur'].$lte = maxEur;
    if (Object.keys(filter['price.eur']).length === 0) delete filter['price.eur'];
  }

  // Warranty
  const wMin = parseInt(document.getElementById('warrantyMin').value, 10);
  const wMax = parseInt(document.getElementById('warrantyMax').value, 10);
  if (!Number.isNaN(wMin) || !Number.isNaN(wMax)) {
    filter['warranty_months'] = {};
    if (!Number.isNaN(wMin)) filter['warranty_months'].$gte = wMin;
    if (!Number.isNaN(wMax)) filter['warranty_months'].$lte = wMax;
    if (Object.keys(filter['warranty_months']).length === 0) delete filter['warranty_months'];
  }

  // MULTI-SPECS
  document.querySelectorAll('#specsBox .filter-section').forEach(section => {
    const field = section.dataset.field;
    const box   = section.querySelector('.check-grid');
    const vals  = getCheckedRawValues(box);
    if (field && vals.length) filter[field] = { $in: vals };
  });

  // MULTI-COMPAT
  document.querySelectorAll('#compatBox .filter-section').forEach(section => {
    const field = section.dataset.field;
    const box   = section.querySelector('.check-grid');
    const vals  = getCheckedRawValues(box);
    if (field && vals.length) filter[field] = { $in: vals };
  });

  // CHAMPS GÉNÉRAUX
  document.querySelectorAll('#generalBox .filter-section').forEach(section => {
    const field = section.dataset.field;
    const kind  = section.dataset.kind;
    if (!field) return;

    if (kind === 'in') {
      const box  = section.querySelector('.check-grid');
      const vals = getCheckedRawValues(box);
      if (vals.length) filter[field] = { $in: vals };
    } else if (kind === 'range') {
      const min = parseFloat(section.querySelector('.range-min')?.value);
      const max = parseFloat(section.querySelector('.range-max')?.value);
      const rng = {};
      if (!Number.isNaN(min)) rng.$gte = min;
      if (!Number.isNaN(max)) rng.$lte = max;
      if (Object.keys(rng).length) filter[field] = rng;
    }
  });

  currentFilter = Object.keys(filter).length ? filter : null;

  // invalide cache et recharge
  for (const k of Object.keys(cache)) delete cache[k];
  loadAndRenderCategory();
  closeModal();
}

function resetFilters(){
  currentFilter = null;
  for (const k of Object.keys(cache)) delete cache[k];
  loadAndRenderCategory();
  closeModal();
}

// ===============================
// Events
// ===============================
async function loadAndRenderCategory(){
  const category=document.getElementById('selectCategory').value;
  if(!category){ document.getElementById('partsSection').style.display='none'; return; }
  try{
    const docs=await fetchParts(category, currentFilter);
    renderPartsTable(category, docs);
  }catch(e){ console.error(e); document.getElementById('partsSection').style.display='none'; }
}
function handleTableClick(e){
  const btn=e.target.closest('.btn-add'); if(!btn) return;
  const tr=btn.closest('tr'); if(!tr) return;
  const cat=tr.dataset.category;
  const item=JSON.parse(decodeURIComponent(tr.dataset.item||'%7B%7D'));
  const qtyInput=tr.querySelector('.qty');
  const qty=sanitizeQty(qtyInput?.value);
  upsertSelection(cat,item,qty);
  if(qtyInput) qtyInput.value=0;
  renderBuild();
}
function handleBuildClick(e){
  const btn=e.target.closest('.btn-remove');
  if(btn){ removeSelection(btn.getAttribute('data-cat'), btn.getAttribute('data-id')); renderBuild(); return; }
  const qtyMini=e.target.closest('.qty-mini');
  if(qtyMini){
    const cat=qtyMini.getAttribute('data-cat'); const id=qtyMini.getAttribute('data-id');
    const n=sanitizeQty(qtyMini.value);
    if(n<=0) removeSelection(cat,id); else { const map=ensureCatMap(cat); if(map[id]) map[id].qty=n; }
    renderBuild();
  }
}

// ===============================
// Init
// ===============================
async function init(){
  const categoriesRaw = await fetchCategories();
  const categories    = normalizeCategories(categoriesRaw);

  // ✅ stocke la liste complète pour le récap
  ALL_CATEGORIES = categories;

  // ✅ prépare les placeholders vides (pour que le récap affiche tout de suite toutes les catégories)
  ensureAllCategoryPlaceholders(categories);

  renderCategories(categories);

  document.getElementById('selectCategory').addEventListener('change', loadAndRenderCategory);
  document.getElementById('clearCategory').addEventListener('click', ()=>{ const c=document.getElementById('selectCategory').value; if(c){ clearCategorySelection(c); renderBuild(); } });

  document.querySelector('#partsTable tbody').addEventListener('click', handleTableClick);
  document.getElementById('buildList').addEventListener('click', handleBuildClick);
  document.getElementById('buildList').addEventListener('change', handleBuildClick);

  // Modal
  document.getElementById('openFilters').addEventListener('click', openModal);
  document.getElementById('closeFilters').addEventListener('click', () => closeModal());
  document.getElementById('applyFilters').addEventListener('click', applyFilters);
  document.getElementById('resetFilters').addEventListener('click', resetFilters);
  document.getElementById('filtersModal').addEventListener('click', (e)=>{ if(e.target.id==='filtersModal') closeModal(); });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

  // Ajouter un champ “général”
  document.getElementById('addGeneralField').addEventListener('click', addGeneralField);

  document.getElementById('btnValider').addEventListener('click', ()=>{ console.log('Configuration validée:', selectedBuild); alert('Configuration validée (voir console).'); });

  // ✅ récap initial avec toutes les catégories (vides)
  renderBuild();
}
window.addEventListener('DOMContentLoaded', init);
