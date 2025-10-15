// public/constructeur.js
async function fetchConstructeurs() {
  const status = document.getElementById('status');
  const q = document.getElementById('search').value.trim();
  const minCount = document.getElementById('minCount').value.trim();

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (minCount) params.set('minCount', minCount);

  status.textContent = 'Chargement…';
  try {
    const res = await fetch('/api/constructeurs?' + params.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderCards(data);
    status.textContent = `${data.length} constructeur(s)`;
  } catch (e) {
    console.error(e);
    status.textContent = 'Erreur: ' + e.message;
  }
}

function renderCards(items) {
  const el = document.getElementById('cards');
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<p>Aucun constructeur.</p>';
    return;
  }
  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHtml(it.brand)}</h3>
      <p><strong>${it.count}</strong> drone(s)</p>
    `;
    el.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.getElementById('apply')?.addEventListener('click', fetchConstructeurs);
window.addEventListener('DOMContentLoaded', fetchConstructeurs);
