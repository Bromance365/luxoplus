# LUXOPLUS — File d'attente en magasin / In-store queue

Trois écrans, une seule page, sans framework : **client** (`/`, via QR), **écran TV** (`/tv`), **équipe** (`/staff`).
FR d'abord, EN ensuite · fuseau America/Montreal · aucune donnée sauf un prénom ou surnom.

| Écran | Qui | Ce que ça fait |
|---|---|---|
| `/?k=…` (QR) | Client | Prend un numéro (prénom + service), voit son rang, l'heure estimée de début et de fin, reçoit une alerte (vibration, son, notification) quand il est appelé. Peut quitter la file. |
| `/tv` | Salle d'attente | Numéros appelés, lavages en cours, prochains, attente pour un nouvel arrivant, QR du jour, annonce vocale fr-CA (après un tap sur « Activer le son »). |
| `/staff` | Équipe | Appeler le suivant, commencer, terminer, absent, remettre en file, retirer, ajouter un client sans appli, régler les baies / durées, fermer la file, afficher le QR. |

## Déploiement (Netlify)
1. Nouveau site (ou celui de `luxoplus-file-attente`) : **Base directory** = `queue`, publish = `public` (déjà dans `netlify.toml`).
2. Variables d'environnement (Site settings → Environment variables, **jamais dans le code**) :
   - `STAFF_PIN` — NIP de l'équipe (6 chiffres ou plus recommandé).
   - `SESSION_SECRET` — chaîne aléatoire de 32+ caractères (`openssl rand -base64 32`).
   Sans elles, la connexion et la prise de numéro refusent de fonctionner (échec sécurisé).
3. Ouvrir `/tv` sur l'écran de la salle d'attente, entrer le NIP une fois (session de 14 jours, ne donne que la clé du QR).
4. Régler le nombre de baies et les durées dans `/staff` → Réglages (valeurs par défaut : 2 baies, durées du catalogue de l'app — à confirmer).

## Comment ça tient
- `netlify/functions/core.mts` : règles et estimation (même logique que la file « Atelier » de l'app : une baie se libère quand son lavage finit, premier arrivé premier servi).
- `netlify/functions/handler.mts` : API HTTP, sessions signées (HMAC), limites de débit, écritures conditionnelles (pas de numéro en double).
- `netlify/functions/api.mts` : branche l'API sur Netlify Blobs. Production = magasin global ; aperçus = magasin du déploiement.
- Les données du jour sont remplacées à minuit (heure de Montréal) : rétention d'un jour.

## Local
```
npm install
npm test        # 17 tests (règles, sécurité API)
npm run e2e     # parcours réel dans Chromium (équipe + TV + téléphone)
npm run dev     # http://localhost:8888, NIP 4321, stockage en mémoire
```

## Vie privée (Loi 25) — résumé
- Collecté : prénom/surnom (affiché sur la TV) + service choisi + heure d'arrivée. Pas de téléphone, courriel, plaque, IP stockée en clair.
- Limitation de débit : empreinte SHA-256 tronquée de l'IP, durée de 10 minutes.
- Hébergeur : Netlify (Blobs). Conservation : jusqu'à minuit (Montréal). Le client peut quitter la file à tout moment.
- À faire par LUXOPLUS : afficher l'avis de confidentialité au comptoir, nommer la personne responsable, vérifier le lieu d'hébergement Netlify.
- Le code du QR change chaque jour : c'est un dissuasif contre les prises de numéro à distance, pas un contrôle d'identité. L'équipe peut retirer un numéro ou fermer la file.
