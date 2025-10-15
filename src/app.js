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

// API : retourne tous les documents depuis lefebvre.droneFpv
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

// Fallback: sert l'index.html pour la racine
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
