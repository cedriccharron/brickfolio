# Brickfolio — contexte pour Claude

Suivi d'investissement LEGO : achats, valeur BrickLink relevée chaque semaine, plus-values. Propriétaire : Cédric. Réponses et textes de l'app en français.

## Architecture (même que Cap'taine)
- PWA en JavaScript sans compilation (modules ES), hébergée sur GitHub Pages ; routes dans le hash (`#/`, `#/p/:id`, `#/p/:id/edit`, `#/p/new`, `#/more`).
- `js/app.js` : écrans en chaînes HTML, état global `S`, délégation d'événements (`data-action`).
- Deux stockages à interface identique : `js/store-demo.js` (navigateur, prix simulés) et `js/store-supabase.js`. `?demo` dans l'URL force le mode démo.
- Calculs purs et testés : `js/invest.js`. Courbes SVG : `js/chart.js`.
- Base : `supabase/schema.sql` (RLS, `is_owner()` sur la table `owners`). Les prix et les fiches de sets ne sont écrits que par la fonction `supabase/functions/bricklink` (clé service).
- Fonction `bricklink` : `lookup` (fiche du set), `refresh` (relevé des prix) et `invoice` (lecture de facture). Signature OAuth 1.0 dans `bricklink.js`, partagé avec les tests Node. Déployée sans vérification JWT ; l'accès est contrôlé dans la fonction (compte `owners`, ou en-tête `x-cron-secret` comparé au secret du Vault par `public.brickfolio_cron_ok`, réservée à service_role). Déploiement depuis l'éditeur Supabase : coller `supabase/bricklink-editeur.ts` (généré par `node tests/build-function.mjs`).
- Relevé planifié : `supabase/cron.sql` (pg_cron + pg_net, lundi 5 h UTC, secret dans Vault `brickfolio_cron_secret`).
- Projet Supabase partagé avec Cap'taine (`zzhzdiuoonhvxndmziju`, plan gratuit limité à 2 projets) : ne pas réutiliser les noms owners, purchases, sets, prices, manual_values, runs, is_owner, touch, brickfolio_cron_ok, ni le bucket Storage `brickfolio-factures` (politique `brickfolio_factures_rw`).

## Décisions prises
- Source de prix : BrickLink, guide des prix « vendus » sur 6 mois (moyenne pondérée par quantité, Europe, EUR, TVA comprise), repli sur les annonces en cours. Un relevé par set, état et jour (`unique (set_no, condition, fetched_on)`).
- Valeurs manuelles (`manual_values`, par compte) fusionnées dans les relevés côté client (`manualRow`, `manual: true`) ; le même jour, la valeur manuelle prime sur BrickLink.
- Valeur d'un set sans prix = son coût. Rendement annualisé affiché seulement après 182 jours.
- Prix de vente saisi en net (total du lot), frais d'achat inclus dans le coût.
- Factures (v0.3) : un fichier par achat (PDF ou photo, 10 Mo max) dans le bucket privé `brickfolio-factures`, chemin `<uid>/<id achat>/<horodatage>-<nom>` ; colonnes `invoice_path/name/type` sur `purchases`. Ouverture par lien signé de 10 min. En démo : data URL dans `brickfolio-demo-factures` (3 Mo max).
- Lecture de facture (v0.4) : action `invoice` de la fonction `bricklink` (comptes `owners` seulement, pas le cron) → Claude `claude-opus-5-5`, effort low, sortie JSON imposée (`output_config.format`), `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Consigne, schéma et nettoyage dans `supabase/functions/bricklink/facture.js` (testés). Secret `ANTHROPIC_API_KEY`. Le client envoie le PDF tel quel (8 Mo max) ou la photo réduite à 2000 px en JPEG ; rien n'est enregistré côté serveur. Frais de port affectés au premier set enregistré de la facture.
- Images : BrickLink, repli sur Brickset (`images.brickset.com/sets/images/<no>.jpg`).

## Tests
- `node tests/logic.test.mjs` (calculs + signature OAuth vérifiée sur l'exemple RFC 5849)
- `tests/schema.test.mjs` (Postgres en mémoire : `npm i @electric-sql/pglite`)
- Navigateur : servir le dossier (`python3 -m http.server`) et ouvrir `/?demo#/`.

## Mise en ligne
Incrémenter `VERSION` dans `sw.js` à chaque déploiement, puis pousser sur `main` (GitHub Pages).

## Prochaines étapes
- Supabase branché le 23/11/2026 (schéma, fonction, cron, compte). Reste : clés BrickLink dans les secrets dès que BrickLink revient (panne fin novembre 2026), puis premier relevé réel.
- Idées : prix de vente conseillé (LEGO retail) via Brickset, statut « retiré » du set, alertes de seuil, import CSV.
