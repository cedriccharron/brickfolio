# Brickfolio — contexte pour Claude

Suivi d'investissement LEGO : achats, valeur BrickLink relevée chaque semaine, plus-values. Propriétaire : Cédric. Réponses et textes de l'app en français.

## Architecture (même que Cap'taine)
- PWA en JavaScript sans compilation (modules ES), hébergée sur GitHub Pages ; routes dans le hash (`#/`, `#/p/:id`, `#/p/:id/edit`, `#/p/new`, `#/more`).
- `js/app.js` : écrans en chaînes HTML, état global `S`, délégation d'événements (`data-action`).
- Deux stockages à interface identique : `js/store-demo.js` (navigateur, prix simulés) et `js/store-supabase.js`. `?demo` dans l'URL force le mode démo.
- Calculs purs et testés : `js/invest.js`. Courbes SVG : `js/chart.js`.
- Base : `supabase/schema.sql` (RLS, `is_owner()` sur la table `owners`). Les prix et les fiches de sets ne sont écrits que par la fonction `supabase/functions/bricklink` (clé service).
- Fonction `bricklink` : `lookup` (fiche du set) et `refresh` (relevé des prix). Signature OAuth 1.0 dans `bricklink.js`, partagé avec les tests Node. Déployée sans vérification JWT ; l'accès est contrôlé dans la fonction (compte `owners`, ou en-tête `x-cron-secret` comparé au secret du Vault par `public.brickfolio_cron_ok`, réservée à service_role). Déploiement depuis l'éditeur Supabase : coller `supabase/bricklink-editeur.ts` (généré par `node tests/build-function.mjs`).
- Relevé planifié : `supabase/cron.sql` (pg_cron + pg_net, lundi 5 h UTC, secret dans Vault `brickfolio_cron_secret`).
- Projet Supabase partagé avec Cap'taine (`zzhzdiuoonhvxndmziju`, plan gratuit limité à 2 projets) : ne pas réutiliser les noms owners, purchases, sets, prices, manual_values, runs, is_owner, touch, brickfolio_cron_ok, ni le bucket Storage `brickfolio-factures` (politique `brickfolio_factures_rw`).

## Décisions prises
- Source de prix : BrickLink, guide des prix « vendus » sur 6 mois (moyenne pondérée par quantité, Europe, EUR, TVA comprise), repli sur les annonces en cours. Un relevé par set, état et jour (`unique (set_no, condition, fetched_on)`).
- Valeurs manuelles (`manual_values`, par compte) fusionnées dans les relevés côté client (`manualRow`, `manual: true`) ; le même jour, la valeur manuelle prime sur BrickLink.
- Tableau de bord (v0.5) : `analyze()` → ligne (situation, tendances `trends()` 3 mois / 1 an, projection, durée de détention) ; `stats()` sur les lignes filtrées ; `filterRows()` / `sortRows()`. Tendance : relevé de départ au plus près de la date de début (pas plus vieux que la moitié de la période), historique ≥ 60 % de la période. Projection = rythme annuel borné [−50 %, +100 %]. Filtres gardés dans `localStorage` `brickfolio-filters`.
- Nom affiché d'un achat (v0.5.1) : `purchases.name` (choisi, rempli par la facture sans « LEGO ») sinon catalogue BrickLink sinon numéro. Liste : date d'achat + boutique sous le numéro.
- Valeur d'un set sans prix = son coût. Rendement annualisé affiché seulement après 182 jours.
- Prix de vente saisi en net (total des boîtes vendues), frais d'achat inclus dans le coût. Vente partielle (v0.5.2) : `splitSale()` partage l'achat (vendu = nouvel id, frais au prorata arrondis au centime) ; la facture est partagée (`linkInvoice`) et le fichier n'est supprimé que si plus aucun achat n'y renvoie (`dropFileIfUnused`).
- Fenêtres (`<dialog>`) : réagir à l'événement `submit` du formulaire (`e.submitter.value`), pas seulement à `close` (pas déclenché dans certains navigateurs intégrés).
- Factures (v0.3) : un fichier par achat (PDF ou photo, 10 Mo max) dans le bucket privé `brickfolio-factures`, chemin `<uid>/<id achat>/<horodatage>-<nom>` ; colonnes `invoice_path/name/type` sur `purchases`. Ouverture par lien signé de 10 min. En démo : data URL dans `brickfolio-demo-factures` (3 Mo max).
- Lecture de facture (v0.4, gratuite, sans serveur) : `js/invoice-read.js` extrait le texte (pdf.js 4.10.38 pour les PDF, Tesseract.js 5.1.1 `fra+eng` pour les photos et PDF scannés, chargés à la demande depuis jsDelivr) ; `js/invoice-parse.js` en tire vendeur, date, sets, prix, frais, remise et total par règles (tests : `node tests/invoice.test.mjs`). Le choix d'une lecture par Claude (payante) a été écarté par Cédric. Frais affectés au premier set enregistré de la facture.
- Images : BrickLink, repli sur Brickset (`images.brickset.com/sets/images/<no>.jpg`).

## Tests
- `node tests/logic.test.mjs` (calculs + signature OAuth vérifiée sur l'exemple RFC 5849)
- `node tests/invoice.test.mjs` (lecture des factures à partir de leur texte)
- `tests/schema.test.mjs` (Postgres en mémoire : `npm i @electric-sql/pglite`)
- Navigateur : servir le dossier (`python3 -m http.server`) et ouvrir `/?demo#/`.

## Mise en ligne
Incrémenter `VERSION` dans `sw.js` à chaque déploiement, puis pousser sur `main` (GitHub Pages).

## Prochaines étapes
- Supabase branché le 23/11/2026 (schéma, fonction, cron, compte). Reste : clés BrickLink dans les secrets dès que BrickLink revient (panne fin novembre 2026), puis premier relevé réel.
- Idées : prix de vente conseillé (LEGO retail) via Brickset, statut « retiré » du set, alertes de seuil, import CSV.
