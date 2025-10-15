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

// Healthcheck
app.get('/health', (req, res) => res.json({ ok: true }));

// Pages
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/constructeur', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'constructeur.html'));
});

// API debug simple
app.get('/api/droneFpv', async (req, res, next) => {
  try {
    await connect();
    const col = getCollection('droneFpv');
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
    const docs = await col.find({}).limit(limit).toArray();
    res.json(docs);
  } catch (err) { next(err); }
});

// Catégories
app.get('/api/categories', async (req, res, next) => {
  try {
    await connect();
    const col = getCollection('droneFpv');
    const categories = await col.distinct('category');
    res.json(categories || []);
  } catch (err) { next(err); }
});

// Distinct multiples
// GET /api/distinct?category=batteries&fields=brand,price.currency,specs.connector
app.get('/api/distinct', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    const fields = String(req.query.fields || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!category || !fields.length) {
      return res.status(400).json({ error: 'Paramètres "category" et "fields" requis' });
    }
    const isSafeKey = (k) => /^[a-zA-Z0-9_.-]+$/.test(k);
    for (const f of fields) if (!isSafeKey(f)) return res.status(400).json({ error: `Champ invalide: ${f}` });

    await connect();
    const col = getCollection('droneFpv');
    const out = {};
    for (const f of fields) {
      out[f] = await col.distinct(f, { category });
    }
    res.json(out);
  } catch (err) { next(err); }
});

// Range min/max numérique
// GET /api/range?category=batteries&field=price.eur
app.get('/api/range', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    const field = String(req.query.field || '').trim();
    const isSafeKey = (k) => /^[a-zA-Z0-9_.-]+$/.test(k);
    if (!category || !field || !isSafeKey(field)) {
      return res.status(400).json({ error: 'Paramètres "category" et "field" requis' });
    }
    await connect();
    const col = getCollection('droneFpv');

    const pipeline = [
      { $match: { category, [field]: { $type: 'number' } } },
      { $group: { _id: null, min: { $min: `$${field}` }, max: { $max: `$${field}` } } },
      { $project: { _id: 0, min: 1, max: 1 } }
    ];
    const [result] = await col.aggregate(pipeline).toArray();
    res.json(result || { min: null, max: null });
  } catch (err) { next(err); }
});

// Clés disponibles dans specs
app.get('/api/spec-keys', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });
    await connect();
    const col = getCollection('droneFpv');

    const pipeline = [
      { $match: { category, specs: { $type: 'object' } } },
      { $project: { arr: { $objectToArray: '$specs' } } },
      { $unwind: '$arr' },
      { $group: { _id: '$arr.k' } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, key: '$_id' } }
    ];
    const rows = await col.aggregate(pipeline).toArray();
    res.json(rows.map(r => r.key));
  } catch (err) { next(err); }
});

// Clés disponibles dans compat
app.get('/api/compat-keys', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });
    await connect();
    const col = getCollection('droneFpv');

    const pipeline = [
      { $match: { category, compat: { $type: 'object' } } },
      { $project: { arr: { $objectToArray: '$compat' } } },
      { $unwind: '$arr' },
      { $group: { _id: '$arr.k' } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, key: '$_id' } }
    ];
    const rows = await col.aggregate(pipeline).toArray();
    res.json(rows.map(r => r.key));
  } catch (err) { next(err); }
});

// ✅ NOUVEAU : Clés “générales” (tous les champs scalaires au niveau racine)
// GET /api/field-keys?category=frames
app.get('/api/field-keys', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });

    await connect();
    const col = getCollection('droneFpv');

    const pipeline = [
      { $match: { category } },
      { $limit: 5000 },
      { $project: { arr: { $objectToArray: '$$ROOT' } } },
      { $unwind: '$arr' },
      { $group: { _id: '$arr.k', types: { $addToSet: { $type: '$arr.v' } } } },
      { $project: { _id: 0, key: '$_id', types: 1 } }
    ];
    const rows = await col.aggregate(pipeline).toArray();

    const NUMERIC_TYPES = new Set(['double','int','long','decimal','number']);
    const scalar = [];
    const numeric = [];

    for (const r of rows) {
      const k = r.key;
      if (['_id','category','specs','compat','price'].includes(k)) continue; // déjà gérés ailleurs
      const tset = new Set(r.types || []);
      const hasNum = [...tset].some(t => NUMERIC_TYPES.has(t));
      const hasStringOrBool = tset.has('string') || tset.has('bool') || tset.has('boolean');
      if (hasNum) numeric.push(k);
      else if (hasStringOrBool) scalar.push(k);
    }

    // On ajoute les champs de price à la main pour “tous les champs”
    // si tu veux les intégrer au select général.
    const hasPrice = rows.some(r => r.key === 'price');
    if (hasPrice) {
      numeric.push('price.eur');
      scalar.push('price.currency');
    }

    res.json({
      scalar: [...new Set(scalar)].sort(),
      numeric: [...new Set(numeric)].sort()
    });
  } catch (err) { next(err); }
});

// Pièces avec FILTRES côté serveur (résultat direct)
app.get('/api/parts', async (req, res, next) => {
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" manquant' });

    let extraFilter = {};
    if (req.query.filter) {
      try {
        const parsed = JSON.parse(req.query.filter);
        if (parsed && typeof parsed === 'object') extraFilter = parsed;
      } catch {
        return res.status(400).json({ error: 'Paramètre "filter" invalide (JSON attendu)' });
      }
    }

    const isSafeKey = (k) => /^[a-zA-Z0-9_.-]+$/.test(k);
    for (const k of Object.keys(extraFilter)) {
      if (!isSafeKey(k) && !k.startsWith('$')) {
        return res.status(400).json({ error: `Clé de filtre non autorisée: ${k}` });
      }
    }

    await connect();
    const col = getCollection('droneFpv');
    const limit = Math.min(parseInt(req.query.limit || '1000', 10), 5000);
    const query = Object.assign({ category }, extraFilter);
    const docs = await col.find(query).limit(limit).toArray();
    res.json(docs);
  } catch (err) { next(err); }
});

// Gestion des erreurs
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
});

app.listen(PORT, () => {
  console.log(`➡️  Serveur démarré sur http://localhost:${PORT}`);
});
