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

// ---- Helper de log par handler ----
function logCall(fnName, req) {
  console.log(`▶ ${fnName}: ${req.method} ${req.originalUrl}`);
}

app.use(helmet());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------- Pages ----------------
function healthHandler(req, res) {
  logCall('healthHandler', req);
  res.json({ ok: true });
}
app.get('/health', healthHandler);

function homePageHandler(_req, res) {
  console.log('▶ homePageHandler: GET /');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
}
app.get('/', homePageHandler);

function constructeurPageHandler(_req, res) {
  console.log('▶ constructeurPageHandler: GET /constructeur');
  res.sendFile(path.join(__dirname, '..', 'public', 'constructeur.html'));
}
app.get('/constructeur', constructeurPageHandler);

// ------------- Debug simple -------------
async function droneFpvHandler(req, res, next) {
  logCall('droneFpvHandler', req);
  try {
    await connect();
    const col = getCollection('droneFpv');
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
    const docs = await col.find({}).limit(limit).toArray();
    res.json(docs);
  } catch (err) { next(err); }
}
app.get('/api/droneFpv', droneFpvHandler);

// --------- DISTINCT des catégories ---------
async function categoriesHandler(req, res, next) {
  logCall('categoriesHandler', req);
  try {
    await connect();
    const col = getCollection('droneFpv');
    const categories = await col.distinct('category');
    res.json(categories || []);
  } catch (err) { next(err); }
}
app.get('/api/categories', categoriesHandler);

// --------- DISTINCT multi-champs ---------
async function distinctHandler(req, res, next) {
  logCall('distinctHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    const fields = String(req.query.fields || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (!category || !fields.length) {
      return res.status(400).json({ error: 'Paramètres "category" et "fields" requis' });
    }

    const SAFE_KEY_RE = /^[a-zA-Z0-9_.\-]+$/;
    for (const f of fields) {
      if (!SAFE_KEY_RE.test(f)) {
        return res.status(400).json({ error: `Champ invalide: ${f}` });
      }
    }

    await connect();
    const col = getCollection('droneFpv');
    const out = {};
    for (const f of fields) {
      out[f] = await col.distinct(f, { category });
    }
    res.json(out);
  } catch (err) { next(err); }
}
app.get('/api/distinct', distinctHandler);

// --------- RANGE min/max ---------
async function rangeHandler(req, res, next) {
  logCall('rangeHandler', req);
  try {
    const category = String(req.query.category || '').trim();
    const field = String(req.query.field || '').trim();
    const SAFE_KEY_RE = /^[a-zA-Z0-9_.\-]+$/;

    if (!category || !field || !SAFE_KEY_RE.test(field)) {
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
}
app.get('/api/range', rangeHandler);

// --------- Keys dans specs ---------
async function specKeysHandler(req, res, next) {
  logCall('specKeysHandler', req);
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
}
app.get('/api/spec-keys', specKeysHandler);

// --------- Keys dans compat ---------
async function compatKeysHandler(req, res, next) {
  logCall('compatKeysHandler', req);
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
}
app.get('/api/compat-keys', compatKeysHandler);

// --------- Keys "générales" ---------
async function fieldKeysHandler(req, res, next) {
  logCall('fieldKeysHandler', req);
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
}
app.get('/api/field-keys', fieldKeysHandler);

// --------- Parts (filtre JSON) ---------
async function partsHandler(req, res, next) {
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

    const SAFE_KEY_RE = /^[a-zA-Z0-9_.\-]+$/;
    for (const k of Object.keys(extraFilter)) {
      if (!SAFE_KEY_RE.test(k) && !k.startsWith('$')) {
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
}
app.get('/api/parts', partsHandler);

// ====== Nouveau handler issu du conflit, renommé en *2* ======
// Liste paginée générique (GET /api/parts2?page=&limit=&...filtres plats...)
async function partsHandler2(req, res, next) {
  logCall('partsHandler2', req);
  try {
    await connect();
    const col = getCollection('droneFpv');

    // Pagination
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 200);
    const skip  = (page - 1) * limit;

    // Builder générique des filtres à partir de la query (clé=valeur)
    const filter = {};
    for (const [key, raw] of Object.entries(req.query)) {
      if (key === 'page' || key === 'limit') continue;
      const val = String(raw).trim();
      if (val === '') continue;

      if (key.toLowerCase() === 'name') {
        filter[key] = { $regex: val, $options: 'i' };
        continue;
      }
      if (val.includes(',')) {
        const arr = val.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) filter[key] = { $in: arr };
        continue;
      }
      if (/^(true|false)$/i.test(val)) {
        filter[key] = val.toLowerCase() === 'true';
        continue;
      }
      filter[key] = val;
    }

    const totalDocs = await col.countDocuments(filter);
    const items = await col
      .find(filter)
      .sort({ view: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
    const hasPrevPage = page > 1;
    const hasNextPage = page < totalPages;

    res.json({ items, page, limit, totalDocs, totalPages, hasPrevPage, hasNextPage });
  } catch (err) { next(err); }
}
app.get('/api/parts2', partsHandler2);

// IMPORTANT : parser JSON (pour les PUT/POST qui suivent)
app.use(express.json({ limit: '2mb' }));

// ---- Enregistrer / insérer via REQUÊTE MongoDB (upsert) ----
app.put('/api/droneFpvAdd', async (req, res, next) => {
  logCall('droneFpvAdd', req);
  try {
    await connect();
    const col = getCollection('droneFpv');

    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Corps JSON requis' });
    }

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
      });
    }

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
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Doublon (_id déjà présent)', details: err.keyValue });
    }
    next(err);
  }
});

// ------------- Erreurs -------------
function errorHandler(err, req, res, _next) {
  console.error('✖ errorHandler:', err);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
}
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`➡️  Serveur démarré sur http://localhost:${PORT}`);
});
