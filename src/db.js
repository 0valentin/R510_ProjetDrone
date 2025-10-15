// src/db.js
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'projet';

if (!uri) {
  throw new Error('MONGODB_URI manquant. Définissez-le dans .env');
}

let client; // Singleton
let db;

async function connect() {
  if (db) return db;
  client = new MongoClient(uri, {
    maxPoolSize: 10,
  });
  await client.connect();
  db = client.db(dbName);
  return db;
}

function getCollection(name) {
  if (!db) throw new Error('Appel getCollection avant connexion DB.');
  return db.collection(name);
}

async function close() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}

module.exports = { connect, getCollection, close };
