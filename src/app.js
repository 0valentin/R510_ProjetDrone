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
    const col = getCollection('pieces');
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 200);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.name) filter.name = req.query.name;

    const items = await col.find(filter).sort({ view: 1 }).skip(skip).limit(limit).toArray();
    const total = await col.countDocuments(filter);
    res.json({ items, total, page, limit });
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
