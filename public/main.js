// public/main.js — pagination + panneau filtres avec SELECTs lazy (distincts par champ au clic)

/***********************
 * ÉTAT DE L’APPLICATION
 ***********************/
let pageActuelle = 1;
const taillePage = 24;
let filtresCourants = {};          // { category: 'moteur', brand: 'GEPRC', ... }
let dernieresColonnesConnues = []; // colonnes détectées au dernier rendu
const showable = [];
const filtrable = [];

/*******************************
 * OUTIL : échapper le HTML
 *******************************/
function echapperHtml(texte) {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/********************************************
 * APPELS API
 ********************************************/
async function recupererPieces({ page = 1, limit = taillePage, ...filtres } = {}) {
  const parametres = new URLSearchParams();
  parametres.set('page', String(page));
  parametres.set('limit', String(limit));
  Object.entries(filtres).forEach(([cle, valeur]) => {
    if (valeur !== undefined && valeur !== null && String(valeur).trim() !== '') {
      parametres.set(cle, String(valeur));
    }
  });

  const reponse = await fetch(`/api/pieces?${parametres.toString()}`);
  if (!reponse.ok) throw new Error(await reponse.text());
  return reponse.json();
}

// ⚠️ LAZY distinct: un seul champ à la fois, version simple (pas de filtres passés côté serveur)
async function recupererDistinctPourChamp(champ) {
  const res = await fetch(`/api/pieces/distinct/${encodeURIComponent(champ)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json(); // { field, values: [...] }
  return Array.isArray(data.values) ? data.values : [];
}

/*********************************
 * AFFICHAGE : tableau des pièces
 *********************************/
function afficherTableau(documents) {
  const enTete = document.querySelector('#dataTable thead');
  const corps = document.querySelector('#dataTable tbody');
  enTete.innerHTML = '';
  corps.innerHTML = '';

  if (!Array.isArray(documents) || documents.length === 0) {
    enTete.innerHTML = '<tr><th>Aucun document</th></tr>';
    corps.innerHTML = '<tr><td>La collection est vide ou aucun résultat pour ces filtres.</td></tr>';
    genererSelectsFiltresDepuisColonnes(dernieresColonnesConnues);
    return;
  }

  // Colonnes dynamiques
  const colonnes = new Set(['_id']);
  for (const doc of documents) Object.keys(doc).forEach(cle => colonnes.add(cle));
  const listeColonnes = Array.from(colonnes);
  dernieresColonnesConnues = listeColonnes;

  // En-têtes
  const ligneEnTete = document.createElement('tr');
  listeColonnes.forEach(cle => {
    const th = document.createElement('th');
    th.textContent = cle;
    ligneEnTete.appendChild(th);
  });
  enTete.appendChild(ligneEnTete);

  // Lignes
  for (const doc of documents) {
    const tr = document.createElement('tr');
    listeColonnes.forEach(cle => {
      const td = document.createElement('td');
      const valeur = doc[cle];
      if (valeur === undefined || valeur === null) {
        td.textContent = '';
      } else if (typeof valeur === 'object') {
        td.innerHTML = `<pre>${echapperHtml(JSON.stringify(valeur, null, 2))}</pre>`;
      } else {
        td.textContent = String(valeur);
      }
      tr.appendChild(td);
    });
    corps.appendChild(tr);
  }

  // Génère/MAJ les selects (vides au départ, chargés à la demande)
  genererSelectsFiltresDepuisColonnes(listeColonnes);
}

/*********************************************************
 * PAGINATION (HAUT ET BAS)
 *********************************************************/
function assurerControlesPagination() {
  const table = document.getElementById('dataTable');

  if (!document.getElementById('paginationHaut')) {
    const contHaut = document.createElement('div');
    contHaut.id = 'paginationHaut';
    Object.assign(contHaut.style, {
      display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0'
    });
    contHaut.innerHTML = `
      <button id="boutonFiltrer" type="button">🔎 Filtrer</button>
      <button id="boutonPrecedentHaut">◀ Précédent</button>
      <span id="infoPageHaut"></span>
      <button id="boutonSuivantHaut">Suivant ▶</button>
    `;
    table.insertAdjacentElement('beforebegin', contHaut);
    document.getElementById('boutonFiltrer').addEventListener('click', togglePanneauFiltres);
  }

  if (!document.getElementById('paginationBas')) {
    const contBas = document.createElement('div');
    contBas.id = 'paginationBas';
    Object.assign(contBas.style, {
      display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0'
    });
    contBas.innerHTML = `
      <button id="boutonPrecedentBas">◀ Précédent</button>
      <span id="infoPageBas"></span>
      <button id="boutonSuivantBas">Suivant ▶</button>
    `;
    table.insertAdjacentElement('afterend', contBas);
  }
}

function majControlesPagination({ page, totalPages, hasPrevPage, hasNextPage }) {
  assurerControlesPagination();

  const map = [
    ['Haut', 'boutonPrecedentHaut', 'infoPageHaut', 'boutonSuivantHaut'],
    ['Bas',  'boutonPrecedentBas',  'infoPageBas',  'boutonSuivantBas' ]
  ];

  map.forEach(([_, idPrev, idInfo, idNext]) => {
    const prev = document.getElementById(idPrev);
    const info = document.getElementById(idInfo);
    const next = document.getElementById(idNext);

    info.textContent = `Page ${page} / ${totalPages}`;
    prev.disabled = !hasPrevPage;
    next.disabled = !hasNextPage;

    prev.onclick = () => chargerPagePieces(page - 1, { remonterEnHaut: true });
    next.onclick = () => chargerPagePieces(page + 1, { remonterEnHaut: true });
  });
}

/**********************************************
 * PANNEAU DE FILTRES (overlay + SELECTs lazy)
 **********************************************/
function assurerPanneauFiltres() {
  if (document.getElementById('panneauFiltres')) return;

  const overlay = document.createElement('div');
  overlay.id = 'panneauFiltres';
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: '360px', maxWidth: '90vw',
    background: '#fff', borderLeft: '1px solid #ddd',
    boxShadow: '-8px 0 16px rgba(0,0,0,0.08)',
    padding: '16px',
    transform: 'translateX(100%)',
    transition: 'transform 0.25s ease',
    zIndex: 9999, overflowY: 'auto',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  });

  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;">
      <h3 style="margin:0;font-size:18px;">Filtres</h3>
      <button id="boutonFermerFiltres" type="button" title="Fermer">✖</button>
    </div>
    <div id="contenuFiltres" style="display:grid; gap:12px; margin-bottom:12px;">
      <!-- selects générés dynamiquement -->
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button id="boutonReinitialiserFiltres" type="button">Réinitialiser</button>
      <button id="boutonAppliquerFiltres" type="button">Appliquer</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('boutonFermerFiltres').addEventListener('click', fermerPanneauFiltres);
  document.getElementById('boutonReinitialiserFiltres').addEventListener('click', () => {
    filtresCourants = {};
    // vider les selects
    const cont = document.getElementById('contenuFiltres');
    cont.querySelectorAll('select[data-cle]').forEach(sel => {
      sel.value = '';
      sel.setAttribute('data-loaded', 'false'); // rechargera si on reclique
      // on laisse la liste d’options vide (lazy)
      const menu = sel.querySelector('option');
      if (menu) menu.textContent = '— Cliquer pour charger —';
    });
    chargerPagePieces(1, { remonterEnHaut: true });
  });
  document.getElementById('boutonAppliquerFiltres').addEventListener('click', () => {
    // lire les selects et appliquer
    const cont = document.getElementById('contenuFiltres');
    const nouveauxFiltres = {};
    cont.querySelectorAll('select[data-cle]').forEach(sel => {
      const cle = sel.getAttribute('data-cle');
      const valeur = sel.value;
      if (valeur && valeur.trim() !== '') nouveauxFiltres[cle] = valeur.trim();
    });
    filtresCourants = nouveauxFiltres;
    chargerPagePieces(1, { remonterEnHaut: true });
    fermerPanneauFiltres();
  });
}

function ouvrirPanneauFiltres() {
  assurerPanneauFiltres();
  document.getElementById('panneauFiltres').style.transform = 'translateX(0)';
}
function fermerPanneauFiltres() {
  const el = document.getElementById('panneauFiltres');
  if (el) el.style.transform = 'translateX(100%)';
}
function togglePanneauFiltres() {
  const el = document.getElementById('panneauFiltres');
  if (!el || el.style.transform === 'translateX(100%)') ouvrirPanneauFiltres();
  else fermerPanneauFiltres();
}

/**
 * Génère des SELECTs vides (lazy) pour chaque colonne filtrable.
 * Au clic/focus sur un select, on va chercher les distincts de cette colonne.
 */
function genererSelectsFiltresDepuisColonnes(colonnes) {
  assurerPanneauFiltres();
  const cont = document.getElementById('contenuFiltres');
  if (!cont) return;

  const ignorer = new Set(['_id', '__v']);
  const colonnesFiltrables = (colonnes || [])
    .filter(cle => typeof cle === 'string' && !ignorer.has(cle));

  cont.innerHTML = '';
  colonnesFiltrables.forEach(cle => {
    const labelLisible = cle;
    const selectId = `select-filtre-${cle}`;

    const bloc = document.createElement('div');
    bloc.innerHTML = `
      <label for="${selectId}" style="display:block; font-size:13px; color:#333; margin-bottom:4px;">
        ${labelLisible}
      </label>
      <select
        id="${selectId}"
        data-cle="${cle}"
        data-loaded="false"
        style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px; background:#fff;"
      >
        <option value="">— Cliquer pour charger —</option>
      </select>
      <small id="hint-${selectId}" style="display:block; color:#888; margin-top:4px;"></small>
    `;

    cont.appendChild(bloc);

    const sel = bloc.querySelector('select');
    const hint = bloc.querySelector(`#hint-${selectId}`);

    // si un filtre est déjà choisi, on le pré-sélectionne (les options seront ajoutées après chargement)
    if (filtresCourants[cle]) {
      sel.value = filtresCourants[cle];
    }

    // Lazy load au focus/click
    const triggerLoad = async () => {
      if (sel.getAttribute('data-loaded') === 'true') return;

      try {
        // UI chargement
        sel.disabled = true;
        sel.innerHTML = `<option>⏳ Chargement…</option>`;
        hint.textContent = 'Récupération des valeurs…';

        const valeurs = await recupererDistinctPourChamp(cle);

        // Remplir les options
        const optionsHtml = [
          `<option value="">— Tous —</option>`,
          ...valeurs.map(v =>
            `<option value="${echapperHtml(v)}"${filtresCourants[cle] === v ? ' selected' : ''}>${echapperHtml(v)}</option>`
          )
        ].join('');
        sel.innerHTML = optionsHtml;
        sel.setAttribute('data-loaded', 'true');
        hint.textContent = `${valeurs.length} option(s)`;

      } catch (e) {
        console.error(e);
        sel.innerHTML = `<option value="">(Erreur de chargement)</option>`;
        hint.textContent = 'Erreur lors du chargement';
      } finally {
        sel.disabled = false;
      }
    };

    sel.addEventListener('focus', triggerLoad);
    sel.addEventListener('click', triggerLoad);
  });
}

/***********************************************
 * CHARGER UNE PAGE ET METTRE À JOUR L’INTERFACE
 ***********************************************/
async function chargerPagePieces(page = 1, { remonterEnHaut = false } = {}) {
  const zoneStatut = document.getElementById('status');
  zoneStatut.textContent = 'Chargement…';

  try {
    const donnees = await recupererPieces({ page, limit: taillePage, ...filtresCourants });

    afficherTableau(donnees.items ?? []);
    majControlesPagination({
      page: donnees.page ?? page,
      totalPages: donnees.totalPages ?? 1,
      hasPrevPage: !!donnees.hasPrevPage,
      hasNextPage: !!donnees.hasNextPage,
    });

    pageActuelle = donnees.page ?? page;
    const nombreAffiche = Array.isArray(donnees.items) ? donnees.items.length : 0;
    zoneStatut.textContent =
      `Page ${pageActuelle}/${donnees.totalPages} – ${nombreAffiche} éléments (total ${donnees.totalDocs})`;

    if (remonterEnHaut) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (erreur) {
    console.error(erreur);
    zoneStatut.textContent = 'Erreur : ' + erreur.message;
  }
}

/**********************
 * INITIALISATION
 **********************/
window.addEventListener('DOMContentLoaded', () => {
  assurerControlesPagination();
  assurerPanneauFiltres();
  chargerPagePieces(1, { remonterEnHaut: true });
});
