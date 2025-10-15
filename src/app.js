// src/app.js
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { connect, getCollection } = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// Healthcheck
app.get('/health', (req, res) => res.json({ ok: true }));

// API : retourne tous les documents depuis lefebvre.droneFpv
// API : agrégat des constructeurs (brand)
app.get('/api/droneFpv', async (req, res, next) => {
  try {
    await connect();
    const col = getCollection('droneFpv');
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
    const docs = await col.find({}).limit(limit).toArray();
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// API pieces: pagination + filtres (category, name)
// Query params: page (1-based), limit, category, name
app.get('/api/pieces', async (req, res, next) => {
  try {
    await connect();
    const col = getCollection('droneFpv');

    // Pagination
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 200);
    const skip  = (page - 1) * limit;

    // --- Builder générique de filtres (pas de vérif côté back) ---
    const filter = {};
    for (const [key, raw] of Object.entries(req.query)) {
      if (key === 'page' || key === 'limit') continue; // ignore la pagination

      // valeur brute -> string
      const val = String(raw).trim();
      if (val === '') continue;

      // name => regex (contient, insensible à la casse)
      if (key.toLowerCase() === 'name') {
        filter[key] = { $regex: val, $options: 'i' };
        continue;
      }

      // listes "a,b,c" => $in
      if (val.includes(',')) {
        const arr = val.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) filter[key] = { $in: arr };
        continue;
      }

      // booléens "true/false"
      if (/^(true|false)$/i.test(val)) {
        filter[key] = val.toLowerCase() === 'true';
        continue;
      }

      // par défaut: égalité simple
      filter[key] = val;
    }
    
    // ✅ Récupération page courante
    const items = await col
      .find(filter)
      .sort({ view: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // ✅ Comptage total
    const totalDocs = await col.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalDocs / limit));

    // ✅ Métadonnées pagination
    const hasPrevPage = page > 1;
    const hasNextPage = page < totalPages;
    const prevPage = hasPrevPage ? page - 1 : null;
    const nextPage = hasNextPage ? page + 1 : null;

    // ✅ Réponse complète adaptée au frontend
    res.json({
      items,
      totalDocs,
      totalPages,
      page,
      limit,
      hasPrevPage,
      hasNextPage,
      prevPage,
      nextPage,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/pieces/distinct/:field
// Retourne les valeurs distinctes de l'attribut demandé (équivalent shell: db.droneFpv.distinct("<field>"))
app.get('/api/pieces/distinct/:field', async (req, res, next) => {
  try {
    await connect();
    const col = getCollection('droneFpv');

    const field = String(req.params.field || '').trim();
    if (!field) return res.status(400).json({ error: 'Attribut manquant.' });

    // Équivalent mongo shell: db.droneFpv.distinct(field)
    const raw = await col.distinct(field);

    // Nettoyage léger + tri alpha insensible
    const values = Array.from(
      new Set(
        (raw || [])
          .filter(v => v !== null && v !== undefined)
          .map(v => String(v).trim())
          .filter(s => s !== '')
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    res.json({ field, values });
  } catch (err) {
    next(err);
  }
});

// Fallback: sert l'index.html pour la racine
app.get('/constructeur', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'constructeur.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Gestion des erreurs
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
});

app.listen(PORT, () => {
  console.log(`➡️  Serveur démarré sur http://localhost:${PORT}`);
});
