# Brickfolio

Portefeuille d'investissement LEGO : tu enregistres tes achats, l'app relève chaque semaine leur valeur sur BrickLink et calcule ta plus-value. Application web installable (PWA), même architecture que Cap'taine : JavaScript sans compilation, hébergement GitHub Pages, Supabase pour les données et le relevé automatique des prix.

## Ce que fait la version 0.4

- **Achats** : numéro du set (recherche du nom et de l'image sur BrickLink), neuf ou occasion, quantité, prix payé, frais, date, boutique, notes.
- **Ventes** : « Vendu » enregistre le prix de vente net ; la plus-value passe en « réalisée ».
- **Valeur** : moyenne des ventes BrickLink des 6 derniers mois, en Europe, TVA comprise, dans l'état de l'achat. S'il n'y a eu aucune vente, moyenne des annonces en cours. Un set sans prix est compté à son coût.
- **Analyse** : valeur totale, montant investi, plus-value latente et réalisée, rendement par set et rendement annualisé (après 6 mois de détention), courbe du portefeuille et de chaque set, détail du marché (nombre de ventes, min/max, annonces).
- **Valeur manuelle** : sur la fiche d'un set, « Encoder » une valeur par boîte (BrickEconomy, 2ememain, estimation…). Elle sert de valeur actuelle jusqu'à un relevé BrickLink plus récent, apparaît dans l'historique et la courbe, et peut être supprimée. Chaque compte a les siennes.
- **Lecture de facture** : dans « Nouvel achat », « Lire une facture » (PDF ou photo) remplit le formulaire : boutique, date, numéro du set, quantité, prix payé par boîte (remises réparties), frais de port. Si la facture contient plusieurs sets, on choisit la ligne, puis l'app propose d'encoder les suivants. La lecture est faite par Claude (Anthropic) via la fonction Supabase : il faut la clé `ANTHROPIC_API_KEY` dans Edge Functions > Secrets (environ 2 à 3 centimes par facture). « Joindre sans lire » garde la facture sans la lire, pour un encodage manuel.
- **Facture** : sur la fiche d'un set, « Joindre » un PDF ou une photo du ticket (10 Mo au plus). On peut l'ouvrir, la remplacer ou la supprimer ; elle est privée (dossier par compte) et supprimée avec l'achat.
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

### 2. Supabase (déjà fait le 23 novembre 2026, dans le projet de Cap'taine)

Brickfolio partage le projet Supabase de Cap'taine (`zzhzdiuoonhvxndmziju`) : le plan gratuit est limité à 2 projets. Aucun nom de table ou de fonction ne se croise.

1. *SQL Editor* : `supabase/schema.sql` (tables, sécurité), puis `insert into public.owners (email) values ('ton@email.be');`. Le compte de connexion est le même que pour Cap'taine.
2. Fonction **`bricklink`** : *Edge Functions > bricklink > Code*, coller `supabase/bricklink-editeur.ts` (généré par `node tests/build-function.mjs` à partir de `supabase/functions/bricklink/`), puis *Deploy updates*. Dans *Settings*, « Verify JWT with legacy secret » reste **désactivé** : la fonction contrôle elle-même qui l'appelle.
   Avec la CLI : `supabase functions deploy bricklink --no-verify-jwt --project-ref zzhzdiuoonhvxndmziju`.
3. *SQL Editor* : `supabase/cron.sql` (en remplaçant `<PROJET>`). Il crée le relevé du lundi et génère dans le coffre chiffré de Supabase (Vault) le secret qui l'autorise : personne n'a à le connaître.
4. `js/config.js` : URL du projet et clé publique (*Project Settings > API*).

**Reste à faire quand BrickLink est en ligne** : *Edge Functions > Secrets*, ajouter `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN`, `BRICKLINK_TOKEN_SECRET` (facultatif : `BRICKLINK_REGION`, par défaut `europe`). Tant qu'ils manquent, la fonction répond « Clés BrickLink absentes ».

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
| `supabase/schema.sql` | Tables `owners`, `purchases`, `sets`, `prices`, `manual_values`, `runs` et sécurité (RLS) |
| `supabase/functions/bricklink/` | Fonction serveur : signature OAuth BrickLink, recherche de set, relevé des prix |
| `supabase/bricklink-editeur.ts` | La même fonction en un seul fichier, à coller dans l'éditeur Supabase (`node tests/build-function.mjs`) |
| `supabase/cron.sql` | Relevé planifié du lundi et son secret (Vault) |
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
