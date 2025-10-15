// public/main.js
async function fetchData() {
  const status = document.getElementById('status');
  status.textContent = 'Chargement…';
  try {
    const res = await fetch('/api/droneFpv');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTable(data);
    status.textContent = `${data.length} documents`;
  } catch (e) {
    console.error(e);
    status.textContent = 'Erreur: ' + e.message;
  }
}

function renderTable(docs) {
  const thead = document.querySelector('#dataTable thead');
  const tbody = document.querySelector('#dataTable tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (!Array.isArray(docs) || docs.length === 0) {
    thead.innerHTML = '<tr><th>Aucun document</th></tr>';
    tbody.innerHTML = '<tr><td>La collection est vide.</td></tr>';
    return;
  }

  // Construire l'ensemble des colonnes en fonction des clés présentes
  const headerSet = new Set(['_id']);
  for (const doc of docs) {
    Object.keys(doc).forEach(k => headerSet.add(k));
  }
  const headers = Array.from(headerSet);

  // En-têtes
  const trHead = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // Lignes
  for (const doc of docs) {
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const td = document.createElement('td');
      const val = doc[h];
      if (val === undefined || val === null) {
        td.textContent = '';
      } else if (typeof val === 'object') {
        td.innerHTML = `<pre>${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
      } else {
        td.textContent = String(val);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.getElementById('refreshBtn')?.addEventListener('click', fetchData);
window.addEventListener('DOMContentLoaded', fetchData);
