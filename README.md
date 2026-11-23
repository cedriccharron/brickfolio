# Brickfolio

Portefeuille d'investissement LEGO : tu enregistres tes achats, l'app relève chaque semaine leur valeur sur BrickLink et calcule ta plus-value. Application web installable (PWA), même architecture que Cap'taine : JavaScript sans compilation, hébergement GitHub Pages, Supabase pour les données et le relevé automatique des prix.

## Ce que fait la version 0.1

- **Achats** : numéro du set (recherche du nom et de l'image sur BrickLink), neuf ou occasion, quantité, prix payé, frais, date, boutique, notes.
- **Ventes** : « Vendu » enregistre le prix de vente net ; la plus-value passe en « réalisée ».
- **Valeur** : moyenne des ventes BrickLink des 6 derniers mois, en Europe, TVA comprise, dans l'état de l'achat. S'il n'y a eu aucune vente, moyenne des annonces en cours. Un set sans prix est compté à son coût.
- **Analyse** : valeur totale, montant investi, plus-value latente et réalisée, rendement par set et rendement annualisé (après 6 mois de détention), courbe du portefeuille et de chaque set, détail du marché (nombre de ventes, min/max, annonces).
- **Relevé automatique** chaque lundi à 6 h, plus un bouton « Mettre à jour maintenant ». Un nouveau set est relevé dès son enregistrement.
- **Export** CSV pour Excel ou Numbers.

## Mode démo

Si `js/config.js` est vide, tout reste dans le navigateur avec un portefeuille d'exemple et des prix **simulés**. Pour l'essayer : `python3 -m http.server` dans ce dossier, puis ouvrir http://localhost:8000.

## Mise en route (en ligne)

### 1. Clés API BrickLink

1. Connecte-toi sur bricklink.com. L'accès à l'API demande un compte avec le statut vendeur (une boutique fermée et vide suffit).
2. Ouvre https://www.bricklink.com/v2/api/register_consumer.page et accepte les conditions.
3. Note la **Consumer Key** et le **Consumer Secret**.
4. Crée un **Access Token** en indiquant l'adresse IP `0.0.0.0`. Les serveurs de Supabase changent d'adresse ; `0.0.0.0` autorise toutes les adresses. Note le **Token Value** et le **Token Secret**.

Ces quatre valeurs restent dans Supabase : elles ne sont jamais dans l'app ni sur GitHub.

### 2. Supabase

1. Crée un projet sur supabase.com (région Europe), ou réutilise celui de Cap'taine : les tables ont d'autres noms. Si tu le réutilises, les comptes autorisés sont différents (`owners` ici, `admins` là-bas).
2. *SQL Editor > New query* : colle le contenu de `supabase/schema.sql`, puis **Run**.
3. *Authentication > Users > Add user > Create new user* : ton e-mail et un mot de passe, coche **Auto Confirm User**. Puis dans le *SQL Editor* : `insert into public.owners (email) values ('ton@email.be');` (en minuscules).
4. *Edge Functions > Deploy a new function > Via Editor*, nom **`bricklink`**. Crée deux fichiers et colles-y le contenu de `supabase/functions/bricklink/index.ts` et de `bricklink.js`. Dans les réglages de la fonction, **désactive « Verify JWT »** : la fonction contrôle elle-même qui l'appelle.
   Avec la CLI : `supabase functions deploy bricklink --no-verify-jwt --project-ref <PROJET>`.
5. *Edge Functions > Secrets* : ajoute `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN`, `BRICKLINK_TOKEN_SECRET` et `CRON_SECRET`. Pour `CRON_SECRET`, choisis une longue phrase au hasard. Facultatif : `BRICKLINK_REGION` (par défaut `europe`).
6. Ouvre `supabase/cron.sql`, remplace `<PROJET>` et `<SECRET>`, puis lance-le dans le *SQL Editor*. Le relevé tourne alors chaque lundi.
7. *Project Settings > API* : copie l'URL du projet et la clé **anon / publishable** dans `js/config.js`.

### 3. Mettre en ligne (GitHub Pages)

1. Crée un dépôt GitHub (ex. `brickfolio`) et dépose-y le contenu de ce dossier.
2. *Settings > Pages* : « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Ouvre `https://<ton-compte>.github.io/brickfolio/` sur l'iPhone, dans Safari, puis Partager > « Sur l'écran d'accueil ».

À chaque mise en ligne, incrémente `VERSION` dans `sw.js`.

## Vérifier que le relevé fonctionne

- Dans l'app : *Plus > Mettre à jour maintenant*. Le message indique le nombre de prix relevés et les échecs.
- Dans Supabase : `select * from public.runs order by id desc limit 5;`.
- Erreur `TOKEN_IP_MISMATCHED` : le token BrickLink n'a pas été créé avec l'IP `0.0.0.0`.
- Erreur `SIGNATURE_INVALID` : une des quatre clés est mal copiée (espace en trop…).

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html`, `manifest.webmanifest`, `sw.js` | Coquille de l'app, installation, hors ligne |
| `js/app.js` | Navigation, écrans, actions |
| `js/invest.js` | Calculs : coût, valeur, plus-value, rendement annualisé, historiques, export (sans interface, testé) |
| `js/chart.js` | Courbes SVG |
| `js/store-demo.js` | Mode démo (navigateur, prix simulés) |
| `js/store-supabase.js` | Mode en ligne : compte, achats, prix, appel de la fonction |
| `supabase/schema.sql` | Tables `owners`, `purchases`, `sets`, `prices`, `runs` et sécurité (RLS) |
| `supabase/functions/bricklink/` | Fonction serveur : signature OAuth BrickLink, recherche de set, relevé des prix |
| `supabase/cron.sql` | Relevé planifié du lundi |
| `tests/` | `node tests/logic.test.mjs` ; `tests/schema.test.mjs` (Postgres en mémoire, `npm i @electric-sql/pglite`) |

## Sécurité (résumé)

- Seuls les e-mails de la table `owners` peuvent se connecter et lire des données ; chacun ne voit que ses propres achats.
- Les prix et fiches de sets ne sont écrits que par la fonction serveur.
- Les clés BrickLink ne quittent jamais Supabase.

## Limites connues

- BrickLink limite l'API à 5 000 appels par jour. Chaque set coûte 2 appels par relevé, plus 1 la première fois.
- Un relevé s'arrête après environ 110 secondes ; les sets restants passent en premier au relevé suivant.
- Les prix BrickLink reflètent le marché des revendeurs. Un acheteur particulier paie souvent un peu plus, et la vente coûte des frais (port, commission).
- LEGO® est une marque du groupe LEGO, qui ne soutient pas cette application.
