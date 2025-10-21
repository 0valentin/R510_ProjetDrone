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
const COL_BUILDS = process.env.COL_BUILDS || 'droneBuilds';  // créations / setups

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

app.get('/builder', (_req, res) => {
  console.log('▶ builderPageHandler: GET /builder');
  res.sendFile(path.join(__dirname, '..', 'public', 'droneList.html'));
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

    // Filtres génériques
    const filter = {};
    for (const [key, raw] of Object.entries(req.query)) {
      if (key === 'page' || key === 'limit') continue;
      if (key.startsWith('$')) continue;

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
      .sort({ view: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
    res.json({
      items,
      totalDocs,
      totalPages,
      page,
      limit,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
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
app.put('/api/droneFpvAdd', async (req, res, next) => {
  logCall('droneFpvAdd', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS); // écrit dans la collection des builds

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
        collection: COL_BUILDS,
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
      collection: COL_BUILDS,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Doublon (_id déjà présent)', details: err.keyValue });
    }
    next(err);
  }
});

// ================== BUILDS: liste + filtres (UNE SEULE FOIS) ==================
app.get('/api/builds', async (req, res, next) => {
  logCall('buildsList', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS);

    // Pagination
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 200);
    const skip  = (page - 1) * limit;

    // Filtres
    const filter = {};
    const name    = (req.query.name || '').trim();
    const creator = (req.query.creator || '').trim();
    const type    = (req.query.type || '').trim();
    const minp    = parseFloat(req.query.min_price);
    const maxp    = parseFloat(req.query.max_price);

    if (name)    filter.name    = { $regex: name, $options: 'i' };
    if (creator) filter.creator = creator;
    if (type)    filter.type    = type;

    if (!Number.isNaN(minp) || !Number.isNaN(maxp)) {
      filter.total_price_eur = {};
      if (!Number.isNaN(minp)) filter.total_price_eur.$gte = minp;
      if (!Number.isNaN(maxp)) filter.total_price_eur.$lte = maxp;
    }

    // Projection "summary" si demandé
    const summary = (req.query.summary || '') === '1';
    const projection = summary
      ? { _id: 1, name: 1, creator: 1, type: 1, total_price_eur: 1 }
      : undefined;

    const totalDocs = await col.countDocuments(filter);
    const items = await col.find(filter, { projection })
      .sort({ created_at: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
    res.json({
      items, totalDocs, totalPages, page, limit,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
    });
  } catch (err) { next(err); }
});

// ================== BUILDS: distinct ==================
app.get('/api/builds/distinct/:field', async (req, res, next) => {
  logCall('buildsDistinct', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS);

    const field = String(req.params.field || '').trim();
    if (!field || !SAFE_KEY_RE.test(field)) {
      return res.status(400).json({ error: 'Champ invalide.' });
    }

    const raw = await col.distinct(field);
    const values = Array.from(
      new Set((raw || [])
        .filter(v => v !== null && v !== undefined)
        .map(v => String(v).trim())
        .filter(Boolean))
    ).sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' }));

    res.json({ field, values });
  } catch (err) { next(err); }
});

// ================== BUILDS: détail ==================
// 1) Si _id fourni -> recherche par _id (string OU ObjectId)
// 2) Sinon fallback exact: name + creator + type + total_price_eur
app.get('/api/builds/detail', async (req, res, next) => {
  logCall('buildsDetail', req);
  try {
    await connect();
    const col = getCollection(COL_BUILDS);

    const { _id, name, creator, type } = req.query;
    const total_price_eur = req.query.total_price_eur;

    let doc;

    if (_id) {
      const q = {};
      // si c'est un ObjectId valide -> on tente
      if (/^[0-9a-fA-F]{24}$/.test(String(_id))) {
        const { ObjectId } = require('mongodb');
        try {
          doc = await col.findOne({ _id: new ObjectId(String(_id)) });
        } catch {
          // on tentera en string ensuite
        }
      }
      // si pas trouvé ou pas un ObjectId, on tente en string brut
      if (!doc) {
        doc = await col.findOne({ _id: String(_id) });
      }
    } else {
      // fallback exact sur les champs
      const q = {};
      if (name)    q.name = String(name);
      if (creator) q.creator = String(creator);
      if (type)    q.type = String(type);
      if (total_price_eur !== undefined) {
        const n = Number(total_price_eur);
        if (!Number.isFinite(n)) {
          return res.status(400).json({ error: 'total_price_eur invalide' });
        }
        q.total_price_eur = n;
      }
      if (!Object.keys(q).length) {
        return res.status(400).json({ error: 'Paramètres insuffisants' });
      }
      doc = await col.findOne(q);
    }

    if (!doc) return res.status(404).json({ error: 'Build introuvable' });
    res.json(doc);
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
