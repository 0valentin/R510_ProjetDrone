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

// Panier { [category]: { [id]: { _id,label,brand,model,qty, doc } } }
const selectedBuild = Object.create(null);
const cache = Object.create(null);
let currentFilter = null;
let ALL_CATEGORIES = [];

// ============= Nouveau : Mode guidé =============
const GUIDED_STEPS = [
  { key:'frame',               label:'Frame',           category:'frames' },
  { key:'motors',              label:'Moteurs',         category:'motors' },
  { key:'batteries',           label:'Batteries',       category:'batteries' },
  { key:'esc',                 label:'ESC',             category:'escs' },
  { key:'flight_controller',   label:'Flight Ctrl',     category:'flight_controllers' },
  { key:'gps_module',          label:'GPS (optionnel)', category:'gps_modules', optional:true },
  { key:'fpv_camera',          label:'FPV Cam',         category:'fpv_cameras' },
  { key:'vtx',                 label:'VTX',             category:'vtx' },
  { key:'antennas',            label:'Antennes',        category:'antennas' },
  { key:'receiver',            label:'Récepteur',       category:'receivers' },
  { key:'radio',               label:'Radio (optionnel)', category:'radios', optional:true },
  { key:'goggles',             label:'Goggles (optionnel)', category:'goggles', optional:true },
  { key:'propellers',          label:'Hélices',         category:'propellers' },
  { key:'charger',             label:'Chargeur',        category:'chargers' },
  { key:'buzzer',              label:'Buzzer',          category:'buzzers' },
];
let isGuided = false;
let guidedIndex = 0;

// ===============================
// Console helpers (navigateur)
// ===============================
const TAG_API = 'background:#0b6; color:#fff; padding:2px 6px; border-radius:4px;';
const TAG_UI  = 'background:#345; color:#fff; padding:2px 6px; border-radius:4px;';
const TAG_CAC = 'background:#888; color:#fff; padding:2px 6px; border-radius:4px;';
function logApiStart(name, url){ console.log(`%cAPI %c${name}`, TAG_API, 'color:#0b6', url); console.time(`[API] ${name}`); }
function logApiEnd(name, status){ console.timeEnd(`[API] ${name}`); console.log(`%cAPI %c${name} ✓`, TAG_API, 'color:#0b6', `status ${status}`); }
function logApiError(name, err){ console.timeEnd(`[API] ${name}`); console.error(`%cAPI %c${name} ✗`, TAG_API, 'color:#c00', err); }
async function fetchJSON(name, url, options){ logApiStart(name, url); const res=await fetch(url,options); logApiEnd(name,res.status); if(!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }

// ===============================
// Utils
// ===============================
function escapeHtml(str){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toLabel(doc){ const p=[]; if(doc.brand)p.push(doc.brand); if(doc.model)p.push(doc.model); if(doc.name&&doc.name!==doc.model)p.push(doc.name); return p.join(' ')||(doc._id??'(élément)');}
function ensureCatMap(cat){ if(!selectedBuild[cat]) selectedBuild[cat]=Object.create(null); return selectedBuild[cat]; }
function sanitizeQty(q){ const n=Math.max(0, parseInt(String(q||'0'),10)||0); return n; }
function upsertSelection(cat,item,qty){
  const map=ensureCatMap(cat);
  const id=item._id;
  const n=sanitizeQty(qty);
  if(!id) return;
  if(n<=0){ delete map[id]; return; }
  map[id]={ _id:id, label:toLabel(item), brand:item.brand??'', model:item.model??'', qty:n, doc:item };
}
function removeSelection(cat,id){ const map=ensureCatMap(cat); delete map[id]; }
function clearCategorySelection(cat){ selectedBuild[cat]=Object.create(null); }

function normalizeCategories(arr){ return Array.from(new Set((arr||[]).filter(x=>typeof x==='string'&&x.trim()).map(s=>s.trim()))).sort(); }
function ensureAllCategoryPlaceholders(cats){ for (const c of cats) if (!selectedBuild[c]) selectedBuild[c] = Object.create(null); }
function pickColumns(docs){
  const set=new Set(); for(const d of docs) Object.keys(d).forEach(k=>set.add(k));
  set.delete('_id');
  const pref=PREFERRED_FIELDS.filter(k=>set.has(k));
  const others=[...set].filter(k=>!pref.includes(k));
  return ['_id', ...pref, ...others].slice(0, 8);
}

// Prix en EUR
function priceToEUR(price){
  if (price == null) return 0;
  if (typeof price === 'number') return price;
  if (typeof price === 'object'){
    if (typeof price.eur === 'number') return price.eur;
    if (price.currency === 'EUR' && typeof price.value === 'number') return price.value;
  }
  return 0;
}
function computeTotalEUR(){
  let total = 0;
  for (const cat of Object.keys(selectedBuild)){
    const map = selectedBuild[cat] || {};
    for (const it of Object.values(map)){
      const unit = priceToEUR(it.doc?.price);
      total += (unit * (it.qty || 0));
    }
  }
  return Math.round(total * 100) / 100;
}
function updateTotalPriceUI(){
  const span = document.getElementById('totalPrice');
  const t = computeTotalEUR();
  span.textContent = `${t.toFixed(2)} €`;
}

// Rendu lisible objets/arrays dans le tableau
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
async function fetchCategories(){ try{ return await fetchJSON('fetchCategories', API_CATEGORIES); }catch(e){ logApiError('fetchCategories', e); console.warn('→ Fallback categories'); return FALLBACK_CATEGORIES; } }
async function fetchDistinct(category, fields){ const url=new URL(API_DISTINCT,location.origin); url.searchParams.set('category',category); url.searchParams.set('fields',fields.join(',')); try{ return await fetchJSON('fetchDistinct', url.toString()); }catch(e){ logApiError('fetchDistinct', e); throw e; } }
async function fetchRange(category, field){ const url=new URL(API_RANGE,location.origin); url.searchParams.set('category',category); url.searchParams.set('field',field); try{ return await fetchJSON('fetchRange', url.toString()); }catch(e){ logApiError('fetchRange', e); throw e; } }
async function fetchSpecKeys(category){ const url=new URL(API_SPEC_KEYS,location.origin); url.searchParams.set('category',category); try{ return await fetchJSON('fetchSpecKeys', url.toString()); }catch(e){ logApiError('fetchSpecKeys', e); throw e; } }
async function fetchCompatKeys(category){ const url=new URL(API_COMP_KEYS,location.origin); url.searchParams.set('category',category); try{ return await fetchJSON('fetchCompatKeys', url.toString()); }catch(e){ logApiError('fetchCompatKeys', e); throw e; } }
async function fetchFieldKeys(category){ const url=new URL(API_FIELD_KEYS,location.origin); url.searchParams.set('category',category); try{ return await fetchJSON('fetchFieldKeys', url.toString()); }catch(e){ logApiError('fetchFieldKeys', e); throw e; } }
async function fetchParts(category, filter){
  if(!category) return [];
  const key=category+'::'+JSON.stringify(filter||{});
  if(cache[key]){ console.log(`%cCACHE %cparts`, TAG_CAC, 'color:#888', key); return cache[key]; }
  const url=new URL(API_PARTS,location.origin);
  url.searchParams.set('category',category);
  if(filter) url.searchParams.set('filter',JSON.stringify(filter));
  try{ const data = await fetchJSON('fetchParts', url.toString()); cache[key]=Array.isArray(data)?data:[]; return cache[key]; }
  catch(e){ logApiError('fetchParts', e); throw e; }
}

// ===============================
// Render
// ===============================
function renderCategories(categories){
  const sel=document.getElementById('selectCategory');
  sel.innerHTML='<option value="">-- Choisir une catégorie --</option>';
  categories.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
}

function renderBuild(){
  const ul=document.getElementById('buildList');
  ul.innerHTML='';
  const cats=(ALL_CATEGORIES&&ALL_CATEGORIES.length)?ALL_CATEGORIES:Object.keys(selectedBuild).sort();

  for(const cat of cats){
    const map = selectedBuild[cat] || {};
    const items = Object.values(map);

    const header=document.createElement('li');
    header.innerHTML=`<strong>${escapeHtml(cat)}</strong>`;
    ul.appendChild(header);

    if(!items.length){
      const li=document.createElement('li'); li.className='build-empty'; li.textContent='— (aucun article)'; ul.appendChild(li);
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

  updateTotalPriceUI();
}

function renderPartsTable(category, docs){
  console.log(`%cUI %crenderPartsTable`, TAG_UI, 'color:#69f', `cat=${category}, rows=${docs?.length||0}`);
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
    if (isGuided) {
      act.innerHTML=`<div class="action-col">
        <button type="button" class="btn-add">Ajouter</button>
        <button type="button" class="btn-add-next">Ajouter & Suivant ▶</button>
      </div>`;
    } else {
      act.innerHTML=`<button type="button" class="btn-add">Ajouter</button>`;
    }
    tr.appendChild(act);

    tbody.appendChild(tr);
  }
  section.style.display='';
}

// ===============================
// Modal helpers (lazy DISTINCT / RANGE)
// ===============================
function mkId(prefix,val){ return prefix+'__'+String(val).replace(/\W+/g,'_'); }
function checkboxList(container,values){
  container.innerHTML='';
  values.forEach(v=>{
    const id=mkId(container.id||'opt', typeof v==='object'?JSON.stringify(v):v);
    const wrapper=document.createElement('label'); wrapper.className='check';
    wrapper.innerHTML=`<input type="checkbox" data-json='${encodeURIComponent(JSON.stringify(v))}' id="${id}"><span>${escapeHtml(String(v))}</span>`;
    container.appendChild(wrapper);
  });
}
function getCheckedRawValues(container){
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(i=>{ try{ return JSON.parse(decodeURIComponent(i.getAttribute('data-json')||'null')); }catch{ return i.value; } })
    .filter(v=>v!==null&&v!==undefined);
}
function makeLazyInSection(fieldPath,title){
  const section=document.createElement('details'); section.className='filter-section'; section.open=false;
  section.dataset.field=fieldPath; section.dataset.kind='in'; section.dataset.loaded='false';
  const labelId=mkId('grid',fieldPath);
  section.innerHTML=`<summary><span class="kv-key">${escapeHtml(title||fieldPath)}</span>${fieldPath.includes('(optionnel)')?'<span class="tag-optional">Optionnel</span>':''}</summary>
    <div class="check-grid" id="${labelId}"><div class="muted">— Ouvrir pour charger —</div></div>`;
  section.addEventListener('toggle',()=>{ if(section.open) lazyLoadInSection(section); });
  return section;
}
function makeLazyRangeSection(fieldPath,title){
  const section=document.createElement('details'); section.className='filter-section'; section.open=false;
  section.dataset.field=fieldPath; section.dataset.kind='range'; section.dataset.loaded='false';
  section.innerHTML=`<summary><span class="kv-key">${escapeHtml(title||fieldPath)}</span></summary>
    <div class="range-row" style="padding:10px;"><label>Min <input type="number" class="range-min" step="any" placeholder="—"></label>
    <label>Max <input type="number" class="range-max" step="any" placeholder="—"></label></div>`;
  section.addEventListener('toggle',()=>{ if(section.open) lazyLoadRangeSection(section); });
  return section;
}
async function lazyLoadInSection(section){
  if(section.dataset.loaded==='true') return;
  const category=document.getElementById('selectCategory').value; if(!category) return;
  const field=section.dataset.field; const grid=section.querySelector('.check-grid');
  try{ grid.innerHTML=`<div class="muted">Chargement…</div>`; const out=await fetchDistinct(category,[field]);
    const values=(out[field]||[]).filter(v=>v!==null&&v!==undefined); checkboxList(grid,values); section.dataset.loaded='true';
  }catch(e){ grid.innerHTML=`<div class="muted">Erreur de chargement</div>`; }
}
async function lazyLoadRangeSection(section){
  if(section.dataset.loaded==='true') return;
  const category=document.getElementById('selectCategory').value; if(!category) return;
  const field=section.dataset.field;
  try{ const {min,max}=await fetchRange(category,field);
    const minEl=section.querySelector('.range-min'); const maxEl=section.querySelector('.range-max');
    if(minEl) minEl.placeholder=(min??''); if(maxEl) maxEl.placeholder=(max??''); section.dataset.loaded='true';
  }catch(e){}
}

// ===============================
// Populate keys (values lazy)
// ===============================
async function populateSpecsAndCompat(category){
  const specsBox=document.getElementById('specsBox');
  const compatBox=document.getElementById('compatBox');
  specsBox.innerHTML='<div class="muted">Chargement…</div>';
  compatBox.innerHTML='<div class="muted">Chargement…</div>';
  try{
    const [specKeys, compatKeys]=await Promise.all([fetchSpecKeys(category), fetchCompatKeys(category)]);
    specsBox.innerHTML=''; for(const k of specKeys) specsBox.appendChild(makeLazyInSection(`specs.${k}`,`specs.${k}`));
    if(!specsBox.children.length) specsBox.innerHTML='<div class="muted">Aucune clé specs disponible</div>';
    compatBox.innerHTML=''; for(const k of compatKeys) compatBox.appendChild(makeLazyInSection(`compat.${k}`,`compat.${k}`));
    if(!compatBox.children.length) compatBox.innerHTML='<div class="muted">Aucune clé compat disponible</div>';
  }catch(e){ specsBox.innerHTML='<div class="muted">Erreur</div>'; compatBox.innerHTML='<div class="muted">Erreur</div>'; }
}
async function populateGeneralFields(category){
  const select=document.getElementById('generalFieldSelect');
  select.innerHTML='<option value="">(choisir)</option>';
  try{
    const { scalar=[], numeric=[] } = await fetchFieldKeys(category);
    if(scalar.length){ const g=document.createElement('optgroup'); g.label='Texte / Booléen';
      scalar.forEach(f=>{ const o=document.createElement('option'); o.value=f; o.textContent=f; g.appendChild(o); }); select.appendChild(g); }
    if(numeric.length){ const g=document.createElement('optgroup'); g.label='Numérique';
      numeric.forEach(f=>{ const o=document.createElement('option'); o.value=f; o.textContent=f; g.appendChild(o); }); select.appendChild(g); }
  }catch(e){}
}
async function addGeneralField(){
  const category=document.getElementById('selectCategory').value; if(!category) return;
  const select=document.getElementById('generalFieldSelect'); const field=select.value.trim(); if(!field) return;
  const box=document.getElementById('generalBox'); if([...box.querySelectorAll('.filter-section')].some(s=>s.dataset.field===field)) return;
  const isNumeric=[...select.selectedOptions].some(o=>o.parentElement?.label==='Numérique');
  if(isNumeric) box.appendChild(makeLazyRangeSection(field,field)); else box.appendChild(makeLazyInSection(field,field));
  select.selectedIndex=0;
}

// ===============================
// Modal open/apply/reset
// ===============================
async function openModal(){
  const category=document.getElementById('selectCategory').value;
  console.log(`%cUI %copenModal`, TAG_UI, 'color:#69f', `category=${category||'(none)'}`);
  if(!category){ alert('Choisis d’abord une catégorie.'); return; }
  try{
    await populateSpecsAndCompat(category);
    await populateGeneralFields(category);
    document.getElementById('generalBox').innerHTML='';
  }catch(e){}
  const m=document.getElementById('filtersModal'); m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
}
function closeModal(){ const m=document.getElementById('filtersModal'); m.classList.add('hidden'); m.setAttribute('aria-hidden','true'); }

function applyFilters(){
  const category=document.getElementById('selectCategory').value;
  if(!category){ closeModal(); return; }
  const filter={};
  document.querySelectorAll('#specsBox .filter-section').forEach(section=>{ const field=section.dataset.field; if(section.dataset.kind!=='in') return;
    const box=section.querySelector('.check-grid'); if(!box) return; const vals=getCheckedRawValues(box); if(field&&vals.length) filter[field]={$in:vals}; });
  document.querySelectorAll('#compatBox .filter-section').forEach(section=>{ const field=section.dataset.field; if(section.dataset.kind!=='in') return;
    const box=section.querySelector('.check-grid'); if(!box) return; const vals=getCheckedRawValues(box); if(field&&vals.length) filter[field]={$in:vals}; });
  document.querySelectorAll('#generalBox .filter-section').forEach(section=>{ const field=section.dataset.field; const kind=section.dataset.kind; if(!field) return;
    if(kind==='in'){ const box=section.querySelector('.check-grid'); if(!box) return; const vals=getCheckedRawValues(box); if(vals.length) filter[field]={$in:vals}; }
    else if(kind==='range'){ const min=parseFloat(section.querySelector('.range-min')?.value); const max=parseFloat(section.querySelector('.range-max')?.value);
      const rng={}; if(!Number.isNaN(min)) rng.$gte=min; if(!Number.isNaN(max)) rng.$lte=max; if(Object.keys(rng).length) filter[field]=rng; } });
  currentFilter = Object.keys(filter).length ? filter : null;
  console.log(`%cUI %capplyFilters`, TAG_UI, 'color:#69f', currentFilter || '(no filters)');
  for(const k of Object.keys(cache)) delete cache[k];
  loadAndRenderCategory(); closeModal();
}
function resetFilters(){ console.log(`%cUI %cresetFilters`, TAG_UI, 'color:#69f'); currentFilter=null; for(const k of Object.keys(cache)) delete cache[k]; loadAndRenderCategory(); closeModal(); }

// ===============================
// Events (mode libre + guidé)
// ===============================
async function loadAndRenderCategory(){
  const category=document.getElementById('selectCategory').value;
  console.log(`%cUI %cloadAndRenderCategory`, TAG_UI, 'color:#69f', category || '(none)');
  if(!category){ document.getElementById('partsSection').style.display='none'; return; }
  try{ const docs=await fetchParts(category, currentFilter); renderPartsTable(category, docs); }
  catch(e){ document.getElementById('partsSection').style.display='none'; }
}

// Reset filtre + cache au changement de catégorie
function onCategoryChange(){
  const m=document.getElementById('filtersModal'); if(m && !m.classList.contains('hidden')) closeModal();
  currentFilter=null;
  for(const k of Object.keys(cache)) delete cache[k];
  const specsBox=document.getElementById('specsBox'); if(specsBox) specsBox.innerHTML='';
  const compatBox=document.getElementById('compatBox'); if(compatBox) compatBox.innerHTML='';
  const generalBox=document.getElementById('generalBox'); if(generalBox) generalBox.innerHTML='';
  console.log(`%cUI %conCategoryChange -> reset filters`, TAG_UI, 'color:#69f');
  loadAndRenderCategory();
}

function handleTableClick(e){
  const addNext=e.target.closest('.btn-add-next');
  const btn=e.target.closest('.btn-add');
  if(!btn && !addNext) return;

  const tr=(btn||addNext).closest('tr'); if(!tr) return;
  const cat=tr.dataset.category;
  const item=JSON.parse(decodeURIComponent(tr.dataset.item||'%7B%7D'));
  const qtyInput=tr.querySelector('.qty');
  const qty=sanitizeQty(qtyInput?.value);
  upsertSelection(cat,item,qty || 1); // si 0 => on met 1 pour guidé
  if(qtyInput) qtyInput.value=0;
  console.log(`%cUI %caddToBuild`, TAG_UI, 'color:#69f', {category:cat, id:item._id, qty: qty || 1});
  renderBuild();

  // En mode guidé : option "Ajouter & Suivant"
  if (addNext && isGuided) {
    guidedNext();
  }
}
function handleBuildClick(e){
  const btn=e.target.closest('.btn-remove');
  if(btn){ removeSelection(btn.getAttribute('data-cat'), btn.getAttribute('data-id')); console.log(`%cUI %cremoveFromBuild`, TAG_UI, 'color:#69f', {cat:btn.getAttribute('data-cat'), id:btn.getAttribute('data-id')}); renderBuild(); return; }
  const qtyMini=e.target.closest('.qty-mini');
  if(qtyMini){ const cat=qtyMini.getAttribute('data-cat'); const id=qtyMini.getAttribute('data-id'); const n=sanitizeQty(qtyMini.value);
    if(n<=0) removeSelection(cat,id); else { const map=ensureCatMap(cat); if(map[id]) map[id].qty=n; }
    console.log(`%cUI %cupdateQty`, TAG_UI, 'color:#69f', {cat,id,qty:n}); renderBuild(); }
}

// ===== JSON payload =====
function buildPayload(){
  const name = document.getElementById('setupName').value.trim();
  const creator = document.getElementById('creatorName').value.trim();
  const type = document.getElementById('setupType').value;

  const items = {};
  for (const cat of Object.keys(selectedBuild)){
    const map = selectedBuild[cat] || {};
    const ids = Object.keys(map);
    if (!ids.length) continue; // skip catégories vides
    const byId = {};
    for (const id of ids){
      const it = map[id];
      if (!it || !it.qty || !it.doc) continue;
      byId[id] = { qty: it.qty, item: it.doc };
    }
    if (Object.keys(byId).length) items[cat] = byId;
  }

  const total = computeTotalEUR();

  return {
    name,
    creator,
    type,
    total_price_eur: total,
    items
  };
}

// UI JSON modal
function openJsonModal(jsonObj){
  const pre = document.getElementById('jsonOutput');
  pre.textContent = JSON.stringify(jsonObj, null, 2);
  const m = document.getElementById('jsonModal');
  m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
}
function closeJsonModal(){
  const m = document.getElementById('jsonModal');
  m.classList.add('hidden'); m.setAttribute('aria-hidden','true');
}
function downloadJson(jsonObj){
  const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = (document.getElementById('setupName').value.trim() || 'setup') + '.json';
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ============= Mode guidé : UI & navigation =============
function guidedSetCategory(index){
  guidedIndex = Math.max(0, Math.min(index, GUIDED_STEPS.length - 1));
  const step = GUIDED_STEPS[guidedIndex];
  // force la catégorie du select (désactivé visuellement)
  const sel = document.getElementById('selectCategory');
  sel.value = step.category;
  onCategoryChange();
  updateGuidedUI();
}
function guidedPrev(){
  if (guidedIndex > 0) guidedSetCategory(guidedIndex - 1);
}
function guidedNext(){
  if (guidedIndex < GUIDED_STEPS.length - 1) {
    guidedSetCategory(guidedIndex + 1);
  } else {
    // dernière étape -> focus recap
    document.getElementById('resultConfig').scrollIntoView({ behavior:'smooth' });
  }
}
function guidedSkip(){
  // on avance d'une étape sans sélectionner (autorisé même si non optionnel)
  guidedNext();
}
function updateGuidedUI(){
  const info = document.getElementById('guidedInfo');
  const stepsEl = document.getElementById('guidedSteps');
  const btnPrev = document.getElementById('guidedPrev');
  const btnNext = document.getElementById('guidedNext');
  const btnSkip = document.getElementById('guidedSkip');
  const btnFinish = document.getElementById('guidedFinish');

  const step = GUIDED_STEPS[guidedIndex];
  info.textContent = `Étape ${guidedIndex+1}/${GUIDED_STEPS.length} — ${step.label}`;

  // rendu des pastilles
  stepsEl.innerHTML = '';
  GUIDED_STEPS.forEach((s, i) => {
    const done = Object.keys(ensureCatMap(s.category)).length > 0;
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'guided-step' + (i===guidedIndex ? ' is-current' : '') + (done?' is-done':'');
    div.setAttribute('role','tab');
    div.setAttribute('aria-selected', i===guidedIndex ? 'true' : 'false');
    div.title = s.label;
    div.innerHTML = `
      <span class="dot"></span>
      <span class="lbl">${escapeHtml(s.label)}</span>
      ${s.optional ? '<span class="opt">opt</span>' : ''}
    `;
    div.addEventListener('click', () => guidedSetCategory(i));
    stepsEl.appendChild(div);
  });

  btnPrev.disabled = guidedIndex === 0;
  const last = guidedIndex === GUIDED_STEPS.length - 1;
  btnNext.classList.toggle('hidden', last);
  btnFinish.classList.toggle('hidden', !last);
  btnSkip.classList.toggle('is-ghost', true);
  // afficher "Ignorer l'étape" seulement si optionnel, sinon toujours possible mais on laisse le bouton quand même :
  btnSkip.textContent = step.optional ? 'Ignorer (optionnel)' : 'Continuer sans sélectionner';
}

function enterGuidedMode(){
  isGuided = true;
  document.getElementById('guidedBar').classList.remove('hidden');
  document.getElementById('guidedBar').setAttribute('aria-hidden','false');
  document.getElementById('modeFree').classList.remove('active');
  document.getElementById('modeGuided').classList.add('active');

  // désactiver visuellement le select de catégorie (mais on le garde pour accessibilité)
  document.getElementById('selectCategory').setAttribute('disabled','disabled');

  guidedSetCategory(0);
}
function exitGuidedMode(){
  isGuided = false;
  document.getElementById('guidedBar').classList.add('hidden');
  document.getElementById('guidedBar').setAttribute('aria-hidden','true');
  document.getElementById('modeGuided').classList.remove('active');
  document.getElementById('modeFree').classList.add('active');

  // réactiver le select catégorie
  document.getElementById('selectCategory').removeAttribute('disabled');

  // ne pas toucher aux filtres ni aux sélections
}

// ===============================
// Init
// ===============================
async function init(){
  const categoriesRaw=await fetchCategories();
  const categories=normalizeCategories(categoriesRaw);
  ALL_CATEGORIES=categories;
  ensureAllCategoryPlaceholders(categories);
  renderCategories(categories);

  document.getElementById('selectCategory').addEventListener('change', onCategoryChange);
  document.getElementById('clearCategory').addEventListener('click', ()=>{ const c=document.getElementById('selectCategory').value; if(c){ clearCategorySelection(c); console.log(`%cUI %cclearCategory`, TAG_UI, 'color:#69f', c); renderBuild(); } });

  document.querySelector('#partsTable tbody').addEventListener('click', handleTableClick);
  document.getElementById('buildList').addEventListener('click', handleBuildClick);
  document.getElementById('buildList').addEventListener('change', handleBuildClick);

  // Modal filtres
  document.getElementById('openFilters').addEventListener('click', openModal);
  document.getElementById('closeFilters').addEventListener('click', () => closeModal());
  document.getElementById('applyFilters').addEventListener('click', applyFilters);
  document.getElementById('resetFilters').addEventListener('click', resetFilters);
  document.getElementById('filtersModal').addEventListener('click', (e)=>{ if(e.target.id==='filtersModal') closeModal(); });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

  // Champs généraux
  document.getElementById('addGeneralField').addEventListener('click', addGeneralField);

  // Validation -> JSON + envoi (optionnel)
  async function envoyerSetupAuServeur(payload) {
    const res = await fetch('/api/droneFpvAdd', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  document.getElementById('btnValider').addEventListener('click', async () => {
    const payload = buildPayload();
    console.log('%cUI %cvalidateBuild', TAG_UI, 'color:#69f', payload);
    openJsonModal(payload);

    try {
      const res = await envoyerSetupAuServeur(payload);
      console.log('Insert OK:', res);
    } catch (e) {
      console.error('Erreur insert:', e);
    }
  });

  // JSON modal
  document.getElementById('closeJson').addEventListener('click', closeJsonModal);
  document.getElementById('jsonModal').addEventListener('click', (e)=>{ if(e.target.id==='jsonModal') closeJsonModal(); });
  document.getElementById('downloadJson').addEventListener('click', ()=>{
    const payload = buildPayload();
    downloadJson(payload);
  });

  // Mode toggle
  document.getElementById('modeFree').addEventListener('click', () => exitGuidedMode());
  document.getElementById('modeGuided').addEventListener('click', () => enterGuidedMode());

  // Guided actions
  document.getElementById('guidedPrev').addEventListener('click', guidedPrev);
  document.getElementById('guidedNext').addEventListener('click', guidedNext);
  document.getElementById('guidedSkip').addEventListener('click', guidedSkip);
  document.getElementById('guidedFinish').addEventListener('click', () => {
    // Terminer : on remonte au récap
    document.getElementById('resultConfig').scrollIntoView({ behavior:'smooth' });
  });

  renderBuild();
}
window.addEventListener('DOMContentLoaded', init);
