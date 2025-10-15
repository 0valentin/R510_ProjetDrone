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
  // pas de req ici, on log quand même la route via un faux objet
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



app.put('/api/droneFpvAdd', addDrone);

// --------- DISTINCT des catégories ---------
async function addDrone(req, res, next) {
  logCall('addDrone', req);
  try {
    await connect();
    const col = getCollection('droneFpv');
    const categories = await col.distinct('category');
    res.json(categories || []);
  } catch (err) { next(err); }
}

// ------------- Erreurs -------------
function errorHandler(err, req, res, _next) {
  console.error('✖ errorHandler:', err);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
}
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`➡️  Serveur démarré sur http://localhost:${PORT}`);
});
