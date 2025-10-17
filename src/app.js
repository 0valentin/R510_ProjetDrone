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

// Collections (configurables via .env)
const COL_PARTS  = process.env.COL_PARTS  || 'droneFpv';     // catalogue de pièces
const COL_BUILDS = process.env.COL_BUILDS || 'droneBuilds';  // créations / setups (NOUVELLE collection)

// ---- Helper log par handler ----
function logCall(fnName, req) {
  console.log(`▶ ${fnName}: ${req.method} ${req.originalUrl}`);
}

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' })); // JSON body pour PUT/POST
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------- Pages ----------------
app.get('/health', (req, res) => {
  logCall('healthHandler', req);
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  console.log('▶ homePageHandler: GET /');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/constructeur', (_req, res) => {
  console.log('▶ constructeurPageHandler: GET /constructeur');
  res.sendFile(path.join(__dirname, '..', 'public', 'constructeur.html'));
});

// ============ Helpers =============
const SAFE_KEY_RE = /^[a-zA-Z0-9_.\-]+$/;

// ============ API DEBUG ============
app.get('/api/droneFpv', async (req, res, next) => {
  logCall('droneFpvHandler', req);
  try {
    await connect();
    const col = getCollection(COL_PARTS);
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
    const docs = await col.find({}).limit(limit).toArray();
    res.json(docs);
  } catch (err) { next(err); }
});

// ============ CATEGORIES ============
app.get('/api/categories', async (req, res, next) => {
  logCall('categoriesHandler', req);
  try {
    await connect();
    const col = getCollection(COL_PARTS);
    const raw = await col.distinct('category');
    const values = Array.from(
      new Set((raw || []).map(v => String(v).trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    res.json(values);
  } catch (err) { next(err); }
});

// ============ DISTINCT multi-champs (par catégorie) ============
app.get('/api/distinct', async (req, res, next) => {
  logCall('distinctHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    const fields = String(req.query.fields || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (!category || !fields.length) {
      return res.status(400).json({ error: 'Paramètres "category" et "fields" requis' });
    }
    for (const f of fields) {
      if (!SAFE_KEY_RE.test(f)) {
        return res.status(400).json({ error: `Champ invalide: ${f}` });
      }
    }

    await connect();
    const col = getCollection(COL_PARTS);
    const out = {};
    for (const f of fields) {
      const raw = await col.distinct(f, { category });
      out[f] = Array.from(
        new Set((raw || [])
          .filter(v => v !== null && v !== undefined)
          .map(v => String(v).trim())
          .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    res.json(out);
  } catch (err) { next(err); }
});

// ============ RANGE min/max (numérique) ============
app.get('/api/range', async (req, res, next) => {
  logCall('rangeHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    const field = String(req.query.field || '').trim();

    if (!category || !field || !SAFE_KEY_RE.test(field)) {
      return res.status(400).json({ error: 'Paramètres "category" et "field" requis' });
    }

    await connect();
    const col = getCollection(COL_PARTS);

    const pipeline = [
      { $match: { category, [field]: { $type: 'number' } } },
      { $group: { _id: null, min: { $min: `$${field}` }, max: { $max: `$${field}` } } },
      { $project: { _id: 0, min: 1, max: 1 } }
    ];
    const [result] = await col.aggregate(pipeline).toArray();
    res.json(result || { min: null, max: null });
  } catch (err) { next(err); }
});

// ============ Keys dans specs ============
app.get('/api/spec-keys', async (req, res, next) => {
  logCall('specKeysHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });

    await connect();
    const col = getCollection(COL_PARTS);

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

// ============ Keys dans compat ============
app.get('/api/compat-keys', async (req, res, next) => {
  logCall('compatKeysHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });

    await connect();
    const col = getCollection(COL_PARTS);

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

// ============ Keys "générales" (scalar/numeric) ============
app.get('/api/field-keys', async (req, res, next) => {
  logCall('fieldKeysHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Paramètre "category" requis' });

    await connect();
    const col = getCollection(COL_PARTS);

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
      if (['_id','category','specs','compat','price'].includes(k)) continue;
      const tset = new Set(r.types || []);
      const hasNum = [...tset].some(t => NUMERIC_TYPES.has(t));
      const hasStringOrBool = tset.has('string') || tset.has('bool') || tset.has('boolean');
      if (hasNum) numeric.push(k);
      else if (hasStringOrBool) scalar.push(k);
    }

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

// ============ Parts (filtre JSON + catégorie) ============
app.get('/api/parts', async (req, res, next) => {
  logCall('partsHandler', req);
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

    for (const k of Object.keys(extraFilter)) {
      if (!SAFE_KEY_RE.test(k) && !k.startsWith('$')) {
        return res.status(400).json({ error: `Clé de filtre non autorisée: ${k}` });
      }
    }

    await connect();
    const col = getCollection(COL_PARTS);
    const limit = Math.min(parseInt(req.query.limit || '1000', 10), 5000);
    const query = Object.assign({ category }, extraFilter);
    const docs = await col.find(query).limit(limit).toArray();
    res.json(docs);
  } catch (err) { next(err); }
});

// ============ Pagination générique (pour /public/main.js) ============
app.get('/api/pieces', async (req, res, next) => {
  logCall('piecesHandler', req);
  try {
    await connect();
    const col = getCollection(COL_PARTS);

    // Pagination
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 200);
    const skip  = (page - 1) * limit;

    // Filtres génériques à partir des query params
    const filter = {};
    for (const [key, raw] of Object.entries(req.query)) {
      if (key === 'page' || key === 'limit') continue; // ignore pagination
      if (key.startsWith('$')) continue; // sécurité injection

      const val = String(raw).trim();
      if (val === '') continue;

      // recherche partielle sur "name"
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

      // booléens
      if (/^(true|false)$/i.test(val)) {
        filter[key] = val.toLowerCase() === 'true';
        continue;
      }

      // égalité simple
      filter[key] = val;
    }

    const totalDocs = await col.countDocuments(filter);
    const items = await col
      .find(filter)
      .sort({ view: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
    const hasPrevPage = page > 1;
    const hasNextPage = page < totalPages;
    const prevPage = hasPrevPage ? page - 1 : null;
    const nextPage = hasNextPage ? page + 1 : null;

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
  } catch (err) { next(err); }
});

// ============ DISTINCT d'un champ (pour /public/main.js) ============
app.get('/api/pieces/distinct/:field', async (req, res, next) => {
  logCall('piecesDistinctHandler', req);
  try {
    await connect();
    const col = getCollection(COL_PARTS);

    const field = String(req.params.field || '').trim();
    if (!field || !SAFE_KEY_RE.test(field)) {
      return res.status(400).json({ error: 'Attribut invalide.' });
    }

    const raw = await col.distinct(field);
    const values = Array.from(
      new Set(
        (raw || [])
          .filter(v => v !== null && v !== undefined)
          .map(v => String(v).trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    res.json({ field, values });
  } catch (err) { next(err); }
});

// ============ Upsert (insert/update) ============
// On garde l'URL /api/droneFpvAdd (utilisée par le front) mais on écrit dans COL_BUILDS
app.put('/api/droneFpvAdd', async (req, res, next) => {
  logCall('droneFpvAdd', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS); // ← nouvelle collection pour les créations

    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Corps JSON requis' });
    }

    // Tableau -> bulkWrite
    if (Array.isArray(payload)) {
      if (!payload.length) return res.status(400).json({ error: 'Tableau vide' });

      const ops = payload.map((doc) => {
        const filter = doc._id
          ? { _id: doc._id }
          : { _id: `${doc.category || 'item'}_${Date.now()}_${Math.random().toString(36).slice(2)}` };
        const toSet = { created_at: new Date(), ...doc };
        return {
          updateOne: {
            filter,
            update: { $set: toSet },
            upsert: true,
          }
        };
      });

      const r = await col.bulkWrite(ops, { ordered: false });
      return res.status(201).json({
        ok: true,
        matchedCount: r.matchedCount,
        modifiedCount: r.modifiedCount,
        upsertedCount: r.upsertedCount,
        upsertedIds: r.upsertedIds,
        collection: COL_BUILDS,
      });
    }

    // Objet unique
    const filter = payload._id
      ? { _id: payload._id }
      : { _id: `${payload.category || 'item'}_${Date.now()}_${Math.random().toString(36).slice(2)}` };

    const update = { $set: { created_at: new Date(), ...payload } };
    const result = await col.updateOne(filter, update, { upsert: true });

    return res.status(201).json({
      ok: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId: result.upsertedId || (payload._id || filter._id),
      collection: COL_BUILDS,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Doublon (_id déjà présent)', details: err.keyValue });
    }
    next(err);
  }
});

// (Optionnel) Lecture des builds pour vérif rapide
app.get('/api/builds', async (req, res, next) => {
  logCall('buildsList', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS);
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    const items = await col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
    res.json({ items, total: items.length, collection: COL_BUILDS });
  } catch (err) { next(err); }
});

// ------------- Gestion des erreurs -------------
app.use((err, req, res, _next) => {
  console.error('✖ errorHandler:', err);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
});

app.listen(PORT, () => {
  console.log(`➡️  Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   COL_PARTS=${COL_PARTS} | COL_BUILDS=${COL_BUILDS}`);
});
