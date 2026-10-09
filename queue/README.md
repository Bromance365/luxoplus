# LUX·O·PLUS — File d’attente

Application HTML pour le garage du Lave Auto Luxoplus, 5300 Av. Van Horne, Montréal.
Page client FR/EN, personnel FR/EN, écran TV bilingue. Le service mobile sur rendez-vous
reste géré par theluxoplus.com.

## État

Version publiée et vérifiée le 9 octobre 2026 sur
`https://luxoplus-file-attente-v2.netlify.app`, avec Supabase dédié au Canada
(`umicfoxlyfubcberbmrv`). Les inscriptions publiques Auth sont désactivées
pour les clients; un compte personnel autorisé a reçu son invitation à `vy@abundances.ai`.
Le compte personnel est confirmé et son tableau de bord connecté a été vérifié.
Les inscriptions à la file sont activées selon les heures configurées : lun–sam, 08 h–18 h.
L’activation a été effectuée depuis le compte connecté, avec l’autorisation du propriétaire.
Le parcours client/TV et la purge planifiée ont été vérifiés sur la production.
Le son du téléviseur physique reste à vérifier au garage.
Le site original `luxoplus-file-attente.netlify.app` dépend d’un autre compte Netlify
selon le contexte Claude Code du 6 octobre; cet accès n’a pas été revérifié ici.

## Fichiers

| Fichier | Usage |
|---|---|
| `index.html` | Inscription, billet, récupération téléphone + numéro, lien de suivi |
| `admin.html` | Connexion, invitation/récupération de mot de passe, gestion des baies et billets |
| `tv.html` | Baies, prochains numéros, QR, carillon et annonces FR/EN |
| `privacy.html` | Avis de confidentialité FR/EN, informations propres à la démo |
| `config.js` | Coordonnées et textes FR/EN; configuration de la démo |
| `build.mjs` | Publication par liste de fichiers autorisés et CSP avec empreintes des scripts |
| `vendor/supabase.js` | SDK Supabase 2.117.2 local, licence MIT jointe |
| `supabase/schema.sql` | Installation atomique sur un projet Luxoplus neuf |
| `supabase/update-queue.sql` | Mise à jour atomique d’une installation existante, sans effacement |
| `supabase/update-performance.sql` | Index de clé étrangère et clé primaire du journal de recherches |
| `supabase/retention.sql` | Purge quotidienne des renseignements personnels après 30 jours |
| `supabase/postflight.sql` | Vérifications après installation |
| `dev/` | Tests et adaptateur local; jamais publiés |

## Prévisualisation et tests

```sh
npm --prefix queue/dev ci
npm --prefix queue/dev run verify  # SQL, build, TV, parcours client/personnel/TV
node queue/build.mjs              # construit queue/dist en démo
cd queue/dev
node serve-built.mjs              # http://localhost:8769 (démo + CSP)
npm run mock                     # http://localhost:8765 (vrai SQL local, faux Supabase)
```

Node 22+ et Chromium requis. `CHROMIUM=/chemin/vers/chromium` permet d’utiliser un
navigateur existant. L’adaptateur local utilise PGlite et le schéma SQL réel, sans
contacter un projet Supabase. Compte **local uniquement** : `admin@test.local` / `test1234`.

## Démo

`demo: true` utilise des clients fictifs et le stockage du navigateur. Les onglets du
même navigateur se synchronisent; les appareils différents ne se synchronisent pas.
Le bandeau « Démo » est visible. Le bouton de remise à zéro de la **démo** réinitialise
uniquement ses données fictives. Les données locales sont renouvelées à la nouvelle
journée de Montréal lors de la prochaine ouverture de page.

## Installation réelle après approbation

1. Créer un projet Supabase **dédié Luxoplus**, région `ca-central-1`, après confirmation
   de l’organisation et du coût. Ne pas utiliser la base d’une autre entreprise.
2. Exécuter `supabase/schema.sql` (projet neuf). Pour une base Luxoplus existante,
   exécuter `supabase/update-queue.sql` plutôt que réinstaller.
3. Désactiver l’inscription publique dans Supabase Auth. Ajouter l’URL exacte
   `https://luxoplus-file-attente-v2.netlify.app/admin.html` aux redirections autorisées
   et configurer l’URL du site. Adapter ces valeurs si le domaine change.
4. Inviter l’adresse du personnel approuvée, avec redirection vers `/admin.html`.
   Le destinataire définit lui-même son mot de passe. Ne pas mettre un mot de passe
   dans un fichier ou dans le chat. Vérifier la livraison des courriels Auth; configurer
   un SMTP approuvé si les restrictions de livraison l’exigent.
5. Ajouter le compte approuvé dans `public.admins`, avec son UUID `auth.users.id`.
   Un utilisateur Auth sans cette entrée reste refusé.
6. Confirmer les prix, durées et heures (voir `RELEASE_APPROVAL.md`), puis modifier
   `public.services` ou `public.settings` si nécessaire.
7. Installer `supabase/retention.sql`; vérifier que le job est actif et que la première
   exécution réussit. La rétention de 30 jours annoncée exige ce job.
8. Définir les variables Netlify ci-dessous et publier la nouvelle version.
9. Exécuter `supabase/postflight.sql`, les conseillers de sécurité Supabase, puis un
   parcours réel sur deux téléphones + personnel + TV. Ne pas annoncer READY avant
   ce test et la validation du matériel TV.

## Variables de déploiement

| Variable Netlify | Valeur |
|---|---|
| `LUX_DEMO` | `false` pour la production, `true` pour une démo |
| `LUX_SUPABASE_URL` | URL HTTPS du projet Luxoplus dédié |
| `LUX_SUPABASE_PUBLISHABLE_KEY` | Clé publique commençant par `sb_publishable_` |

Le build de production refuse une URL absente, une clé fictive ou une clé secrète.
Les clés de service, mots de passe et jetons de gestion ne vont jamais dans le navigateur.
Netlify peut construire depuis la racine du dépôt (`netlify.toml` configure `base=queue`)
ou depuis le dossier `queue`. `dist` contient uniquement les pages, styles, scripts,
licences et `_headers`; aucun SQL, test, rapport QA ou fichier d’environnement.
Les scripts inline sont autorisés par leurs empreintes CSP, sans `unsafe-inline` pour JavaScript.

## Règles de fonctionnement

- Numéros uniques et croissants par journée de Montréal. Les estimations sont toujours
  affichées à l’heure de Montréal, même si le téléphone est réglé dans un autre fuseau.
- Prix et durées viennent de `public.services`; le prix choisi est enregistré avec le billet.
- L’attente simule les baies en parallèle. Les anciens billets actifs sont exclus des
  estimations et expirés lors de la prochaine inscription ou du prochain appel.
- Un forfait est refusé si sa fin estimée dépasse la fermeture de plus que la tolérance
  configurée (30 min par défaut). Ces estimations ne garantissent pas une heure de fin.
- « Appeler le suivant » attribue la première baie libre. « Terminé » libère la baie;
  le personnel appelle ensuite le prochain. Retirer un billet en service depuis le
  personnel réattribue automatiquement la baie au prochain billet en attente.
- Un client peut quitter un billet **en attente** seulement. Un service commencé est
  géré par le personnel. Une baie occupée ne peut pas être retirée de la capacité.
- « Vider les billets actifs » annule les billets en attente/en service du jour,
  conserve les services terminés et les revenus, et ne réutilise pas les numéros.
- Le tableau de bord additionne les prix des services terminés avant taxes; il ne
  confirme pas l’encaissement et ne remplace pas un système de facturation TPS/TVQ.

## Billets et notifications

Le même navigateur restaure son billet. « Retrouver ma place » exige **téléphone +
numéro de billet** (10 essais par 10 minutes et connexion); le téléphone seul est
refusé. Le lien `/#t=UUID` rouvre le billet sur un autre appareil. Ce lien donne accès
au billet : il doit rester privé. Il est retiré de l’adresse après son adoption.

Le billet et la TV sont interrogés toutes les 5 secondes; les estimations affichées
sur le billet changent aux 5 minutes, à l’approche du tour ou avec « Actualiser ».
Il n’y a **aucun SMS ni push en arrière-plan**. Garder la page ouverte pour suivre
les alertes. Les notifications navigateur, lorsqu’elles sont disponibles, sont facultatives.

## TV et confidentialité

Ouvrir `/tv` ou `/tv.html` en plein écran; cliquer « Activer le son » une fois.
Les nouveaux numéros sont annoncés en FR/EN. Le nombre de prochains billets affichés
s’adapte à l’espace disponible; le reste est indiqué par « + N en attente ».
Le volume et les voix doivent être vérifiés sur la vraie télévision.

La fonction publique `get_board()` ne divulgue aucun nom, téléphone, véhicule,
prix ou jeton. Elle conserve `first_name: ''` pour compatibilité avec les anciens écrans.
Les tables ont toutes RLS. Seul le personnel autorisé peut lire la file complète.
L’avis `privacy.html` doit être validé par le propriétaire avant lancement; il ne
constitue pas une attestation de conformité à la Loi 25.
