# QA report — file d'attente Luxoplus + écran TV

Tested revision: working tree on branch `claude/kind-lamport-4aw5m0` · Environment: Node 22, PGlite (Postgres 17 en WebAssembly), Chromium via Playwright, faux Supabase local (`dev/mock-supabase.mjs`) et mode démo. **Pas testé sur l'URL déployée ni sur un vrai projet Supabase.**

Scope of this round: ajout de `tv.html` (écran de salle d'attente), de la fonction SQL publique `get_board()` (+ `supabase/update-tv-board.sql`), de `get_board` dans le mode démo, du lien dans `admin.html`, des tests. Le reste de l'application (client, admin, schéma existant) n'a pas été modifié.

| # | Check | Result | Evidence / reason |
|---|---|---|---|
| 1 | Tests du schéma SQL (`cd dev && npm test`) | PASS | Suite existante intacte + 7 nouveaux tests `get_board` |
| 2 | `get_board` : aucune donnée personnelle | PASS | Test : aucun téléphone, véhicule, nom de famille, prix ni jeton dans la réponse ; `queue` reste illisible pour anon |
| 3 | Écran TV dans Chromium, base SQL réelle (`npm run e2e`) | PASS | 13/13 : baies 1 et 2, prénoms seulement, prochains, QR, pas de scroll à 1920×1080, halo sur nouveau numéro, bandeau fermé + QR masqué |
| 4 | Écran TV en mode démo | PASS | Affiche les lavages en cours |
| 5 | Portrait 390 px | PASS | Pas de défilement horizontal (la page est conçue pour une TV) |
| 6 | Console | PASS | Aucune erreur (polices Google et CDN interceptés dans l'environnement de test) |
| 7 | XSS | PASS | Texte venant de la base inséré uniquement par `textContent` ; seul `innerHTML` : emblème statique de la marque et SVG QR généré localement |
| 8 | Son et annonce vocale | PARTIAL | Code exécuté (clic « Activer le son », carillon) ; voix fr-CA/en-CA et volume non vérifiés sans écran ni haut-parleur → BLOCKED sur matériel réel |
| 9 | Projet Supabase réel (RLS, grant `get_board`) | BLOCKED | Pas d'accès ; testé sur PGlite avec rôles anon/authenticated et révocation/octroi identiques à `schema.sql` |
| 10 | URL déployée, en-têtes, HTTPS | BLOCKED | Non déployé : le réseau de l'environnement refuse `*.netlify.app` |
| 11 | Accessibilité | PARTIAL | `aria-live`, rôles, `prefers-reduced-motion`, contraste hérité de `brand.css`. Aucun audit axe/Lighthouse |
| 12 | Vie privée (Loi 25) | OPEN | Écran public = prénoms visibles : à mentionner dans l'avis au comptoir ; responsable et hébergement à confirmer par LUXOPLUS |

## Findings
| ID | Severity | Finding | Status |
|---|---|---|---|
| T-1 | Low | `get_board` est lisible par tout visiteur anonyme (par conception, comme `get_queue_status`) ; il expose numéros, prénoms et baies. Un tiers peut donc voir qui est en service | Open (documenté) |
| T-2 | Low | La page TV charge supabase-js et les polices depuis des CDN externes (comme les autres pages) ; pas de CSP stricte à cause des scripts en ligne existants | Open |
| T-3 | Info | `ip_hash` utilise `md5` (existant, hors périmètre) | Open |

## Verdict: **BLOCKED** — le code et les tests locaux passent ; READY exige le déploiement, un projet Supabase réel, un test sur la vraie TV (items 8–10) et la confirmation des points Loi 25 (item 12).
