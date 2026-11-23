# Brickfolio — contexte pour Claude

Suivi d'investissement LEGO : achats, valeur BrickLink relevée chaque semaine, plus-values. Propriétaire : Cédric. Réponses et textes de l'app en français.

## Architecture (même que Cap'taine)
- PWA en JavaScript sans compilation (modules ES), hébergée sur GitHub Pages ; routes dans le hash (`#/`, `#/p/:id`, `#/p/:id/edit`, `#/p/new`, `#/more`).
- `js/app.js` : écrans en chaînes HTML, état global `S`, délégation d'événements (`data-action`).
- Deux stockages à interface identique : `js/store-demo.js` (navigateur, prix simulés) et `js/store-supabase.js`. `?demo` dans l'URL force le mode démo.
- Calculs purs et testés : `js/invest.js`. Courbes SVG : `js/chart.js`.
- Base : `supabase/schema.sql` (RLS, `is_owner()` sur la table `owners`). Les prix et les fiches de sets ne sont écrits que par la fonction `supabase/functions/bricklink` (clé service).
- Fonction `bricklink` : `lookup` (fiche du set) et `refresh` (relevé des prix). Signature OAuth 1.0 dans `bricklink.js`, partagé avec les tests Node. Déployée sans vérification JWT ; l'accès est contrôlé dans la fonction (compte `owners` ou en-tête `x-cron-secret`).
- Relevé planifié : `supabase/cron.sql` (pg_cron + pg_net, lundi 5 h UTC).

## Décisions prises
- Source de prix : BrickLink, guide des prix « vendus » sur 6 mois (moyenne pondérée par quantité, Europe, EUR, TVA comprise), repli sur les annonces en cours. Un relevé par set, état et jour (`unique (set_no, condition, fetched_on)`).
- Valeur d'un set sans prix = son coût. Rendement annualisé affiché seulement après 182 jours.
- Prix de vente saisi en net (total du lot), frais d'achat inclus dans le coût.
- Images : BrickLink, repli sur Brickset (`images.brickset.com/sets/images/<no>.jpg`).

## Tests
- `node tests/logic.test.mjs` (calculs + signature OAuth vérifiée sur l'exemple RFC 5849)
- `tests/schema.test.mjs` (Postgres en mémoire : `npm i @electric-sql/pglite`)
- Navigateur : servir le dossier (`python3 -m http.server`) et ouvrir `/?demo#/`.

## Mise en ligne
Incrémenter `VERSION` dans `sw.js` à chaque déploiement, puis pousser sur `main` (GitHub Pages).

## Prochaines étapes
- Brancher Supabase et les clés BrickLink, premier relevé réel.
- Idées : prix de vente conseillé (LEGO retail) via Brickset, statut « retiré » du set, alertes de seuil, import CSV.
