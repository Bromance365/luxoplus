# LUX·O·PLUS — File d'attente du garage

File d'attente virtuelle pour le garage de Lave Auto Luxoplus (5300 Av. Van Horne).
Le client choisit son forfait (Express, Signature+, ABSOLUX) et la taille de son véhicule,
reçoit un numéro, et suit en direct son début estimé. Plusieurs baies travaillent en parallèle.

Le service mobile (le van) fonctionne sur rendez-vous via theluxoplus.com : il n'est pas géré ici.

| Fichier | Rôle |
|---|---|
| `index.html` | Page client bilingue FR/EN : forfait, inscription, billet en direct, « c'est votre tour — baie N » |
| `tv.html` | **Écran de la salle d'attente** (TV) : numéros en service par baie, prochains, attente, QR, son + annonce vocale FR/EN |
| `qr.js` | Générateur de code QR (qrcode-generator, MIT) pour `tv.html` |
| `admin.html` | Tableau de bord du personnel : baies, file, revenus du jour (connexion Supabase Auth) |
| `brand.css` | Charte visuelle reprise de theluxoplus.com |
| `config.js` | Coordonnées, textes des forfaits (FR/EN), URL/clé Supabase |
| `supabase/update-tv-board.sql` | Ajoute l'écran TV à une base Supabase **déjà installée** (une seule exécution) |
| `supabase/schema.sql` | Tables, prix/durées des forfaits, sécurité (RLS) et toute la logique |
| `dev/` | Outils de développement local (pas à déployer) |

## Démo en ligne (sans Supabase)

**https://luxoplus-file-attente.netlify.app** — client : `/` · personnel : `/admin.html` (cliquer « Entrer »).

Avec `demo: true` dans `config.js`, `demo-backend.js` remplace Supabase par un faux serveur dans le
navigateur (mêmes règles que `schema.sql`), pré-rempli de clients fictifs. Les données restent dans le
navigateur : client et personnel se synchronisent entre onglets d'un même appareil, pas entre appareils.
Le bandeau « Démo » en bas permet de passer d'une vue à l'autre, d'ajouter un client fictif ou de tout remettre à zéro.

**Pour passer en vrai :** suivre les étapes ci-dessous, puis mettre `demo: false` dans `config.js`.

## Mise en place Supabase (une seule fois)

1. Créer un projet Supabase (région Canada de préférence).
2. **SQL Editor** → coller et exécuter `supabase/schema.sql`.
3. **Authentication › Sign In / Providers** → désactiver « Allow new users to sign up ».
4. **Authentication › Users › Add user** → créer le compte du personnel (courriel + mot de passe, « Auto confirm »).
5. **SQL Editor** → donner l'accès au tableau de bord :
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'courriel@du-personnel.com';
   ```
6. Vérifier les réglages (valeurs par défaut : lun–sam, 8 h–18 h, 2 baies) :
   ```sql
   update public.settings set
     open_days = '{1,2,3,4,5,6}',      -- 1 = lundi … 7 = dimanche
     open_time = '08:00', close_time = '18:00',
     bays = 2                          -- aussi modifiable depuis le tableau de bord
   where id = 1;
   ```
7. (Optionnel, Loi 25) Activer l'extension **pg_cron** puis planifier la purge des renseignements personnels de plus de 30 jours (commande en bas de `schema.sql`).
8. Dans `config.js`, remplacer `supabaseUrl` et `supabaseKey` (Project Settings › API › clé *publishable*).

## Écran de la salle d'attente (`tv.html`)

Ouvrir `https://…/tv.html` sur la télévision (navigateur plein écran, F11) : un clic sur « Activer le son » une seule fois
(exigé par les navigateurs), puis l'écran se met à jour seul toutes les 5 s.

- **En service** : une tuile par baie (numéro géant, prénom, forfait, temps restant, barre de progression). Un nouveau numéro
  fait sonner un carillon, s'illumine 25 s et est annoncé en français puis en anglais (« Numéro 12, Marie, baie 1 »).
- **Prochains** : 8 prochains numéros avec forfait et début estimé. **Attente pour un nouvel arrivant** en grand.
- **QR** vers la page d'inscription ; remplacé par un bandeau quand la file est fermée ou en pause.
- **Vie privée** : l'écran ne reçoit que le numéro, le **prénom**, la baie et le forfait. Jamais le nom de famille, le téléphone,
  le véhicule ni le prix (fonction `get_board()`, testée). Un écran public affiche donc des prénoms : l'indiquer sur l'avis de confidentialité au comptoir.
- Lien direct depuis le tableau de bord (`admin.html` → « Écran de la salle d'attente »).
- **Base déjà installée ?** exécuter `supabase/update-tv-board.sql` dans le SQL Editor (nouvelles installations : déjà dans `schema.sql`).
- Fonctionne aussi en démo (`demo: true`).

## Modifier les forfaits

Prix et durées (font foi pour le calcul des attentes et des revenus) :
```sql
update public.services set price_sedan = 32.99, price_suv = 42.99, price_truck = 52.99, minutes = 30
where code = 'express';
-- Masquer un forfait : update public.services set active = false where code = 'absolux';
```
Les noms, slogans et listes « inclus » (FR/EN) sont dans `config.js` → `services`.
Un nouveau forfait = une ligne dans `services` + une entrée du même `code` dans `config.js`.

## Règles de fonctionnement

- Numéros attribués par la base, de 1 à N chaque jour (heure de Montréal).
- **Début estimé** : simulation baie par baie à partir de la durée de chaque forfait et du temps déjà écoulé dans les baies occupées.
- Un forfait dont la fin prévue dépasse de plus de 30 min l'heure de fermeture (`settings.close_grace_minutes`) est marqué
  « Trop tard aujourd'hui » et refusé, avec un message invitant à revenir au prochain jour d'ouverture, dès l'ouverture.
  En démo, cette règle se montre avec le bouton « Fermeture » du bandeau.
- « Appeler le suivant » fait entrer le prochain client dans la première baie libre ; « Terminé » libère la baie.
- Si un client en service quitte la file, sa baie est réattribuée automatiquement.

## Informations du client

- Étapes : 01 véhicule (taille, marque et modèle, couleur facultative) → 02 forfait (prix selon la taille) → 03 coordonnées.
- Obligatoires pour rejoindre la file : taille du véhicule, marque et modèle, forfait, nom, téléphone
  (le téléphone sert au futur texto de rappel). Le bouton reste bloqué tant qu'il manque quelque chose.
- Les prix sont affichés « + taxes » ; les taxes sont détaillées à la facturation.
- Sur le billet, l'estimation (voitures devant, attente, heures) est mise à jour aux 5 minutes, au rechargement
  ou avec « Actualiser ». « C'est votre tour » et les annulations restent instantanés.

## Retrouver sa place

1. **Même téléphone / navigateur** : le billet est mémorisé, la page le rouvre automatiquement.
2. **« Retrouver ma place »** : téléphone (obligatoire) + numéro de billet (facultatif) → même billet, même position.
   Un téléphone n'a qu'une place active par jour. Limité à 10 essais / 10 min par connexion.
3. **Lien de suivi** (`index.html#t=…`) : bouton « Copier mon lien de suivi » sur le billet ; sera aussi mis dans le texto.

## Déploiement

Projet Netlify : `luxoplus-file-attente`. `netlify.toml` ne publie que `index.html`, `admin.html`, `tv.html`, `brand.css`,
`config.js`, `demo-backend.js` et `qr.js` (jamais `dev/` ni `supabase/`). Idéalement sur un sous-domaine, ex. `file.theluxoplus.com`,
avec un code QR à l'entrée du garage pointant vers `index.html`.

## Développement local

```bash
cd dev && npm install
npm test        # tests du schéma SQL (Postgres en WebAssembly)
npm run e2e     # écran TV dans un vrai Chromium (base SQL réelle + démo)
npm run mock    # faux Supabase + site sur http://localhost:8765
```

Compte du personnel en local : `admin@test.local` / `test1234`.
Le faux serveur ouvre les inscriptions 24 h/24 ; `REAL_HOURS=1 npm run mock` applique les vraies heures.
