# lefebvre-dronefpv-js (sans EJS)

Mini app Express + MongoDB avec un frontend HTML + JavaScript pur.
Affiche le résultat de `lefebvre.droneFpv.find()` dans un tableau dynamique.

## Démarrage rapide

```bash
npm install
cp .env.example .env   # renseignez MONGODB_URI et DB_NAME=projet
npm run dev            # ou npm start
# puis ouvrez http://localhost:3000
```

## Routes

- `/` : page HTML statique qui construit le tableau en JS via `fetch`.

- `/api/droneFpv` : renvoie tous les documents (limités à 500) depuis `lefebvre.droneFpv`.


## Nouvelle page: Constructeur

- Page: `/constructeur` (HTML/JS/CSS dédiés)
- API: `/api/constructeurs?q=<texte>&minCount=<n>`
