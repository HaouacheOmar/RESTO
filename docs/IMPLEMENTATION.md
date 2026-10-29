# Architecture et implémentation technique

> Le vocabulaire métier est défini dans [`CONTEXT.md`](../CONTEXT.md), et les besoins dans [`PRD.md`](PRD.md).

## 1. Stack

| Couche | Choix |
| :--- | :--- |
| Backend | Python 3.12, **Django 6.1**, **Django REST Framework** |
| Authentification | JWT (`djangorestframework-simplejwt`), mots de passe hachés par Django |
| Temps réel | **Django Channels** + serveur ASGI **Daphne**, channel layer **Redis** |
| Base de données | **PostgreSQL 17** |
| Fichiers | Photos (Carte, Plat du jour) en local dans `server/media/` |
| Back-office | Django admin (tous les modèles) |
| Frontend | À venir (`client/`) |

Tout se lance avec `docker compose up --build` à la racine (`docker-compose.yml`) : PostgreSQL, Redis, le backend (Daphne) et le frontend React servi par nginx sur **http://localhost:8088**. nginx sert l'application et relaie `/api`, `/admin`, `/static`, `/media` et `/ws` vers Django : tout est sur la même origine. En développement, PostgreSQL et Redis seuls (`docker compose up -d postgres redis`, ports hôte 5434 et 6380) et Django dans le `venv/` à la racine. Pour un vrai restaurant : `docker-compose.prod.yml` (HTTPS, sans données de démo, secrets obligatoires, sauvegardes), voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

---

## 2. Architecture

```
  Espaces clients (web / mobile / PWA)
  gérant · réservation · chef · serveur · caisse · livreur · stationneur · stock · client
         │  HTTPS (REST + JWT)            │  WebSocket ws://…/ws/?ticket=<ticket>
         ▼                                ▼
  ┌───────────────────────────────────────────────────────┐
  │ Daphne (ASGI) — config/asgi.py                         │
  │   http → Django + DRF        websocket → Consumer       │
  │  accounts  catalog  inventory  service  analytics       │
  │  realtime                                               │
  └──────────────┬──────────────────────────┬─────────────┘
                 ▼                          ▼
           PostgreSQL                 Redis (channel layer)
```

Le système est distribué au sens où plusieurs postes indépendants partagent un état central et reçoivent des notifications en temps réel. Le channel layer Redis permet de lancer plusieurs instances Daphne derrière un load balancer sans changer le code.

C'est un **monolithe modulaire** : un seul déploiement, mais des modules aux frontières contrôlées. Chaque module expose ce que les autres peuvent utiliser dans son `api.py` ; ses vues, sérialiseurs, modèles et fonctions internes restent privés. Le fichier `server/.importlinter` le vérifie en CI (`lint-imports`) : un import qui contourne un `api.py` fait échouer le build. Les relations entre modules passent par le nom du modèle (`'catalog.Dish'`), sans import.

| Module | Contenu | Expose (`api.py`) |
| :--- | :--- | :--- |
| `config/` | settings (variables d'environnement), routes, ASGI, santé, pagination des listes, administration | (le câblage, peut tout importer) |
| `accounts/` | `User` (rôle, disponibilité), `JobApplication`, permissions par rôle, tickets WebSocket | `User`, permissions par rôle |
| `catalog/` | `Dish` (Carte + Recette), `DailySpecial` (Plat du jour), Menu | `Dish`, `DailySpecial` |
| `inventory/` | `Ingredient` (Ruptures), `StockRequest`, `Supplier` | les trois modèles (lecture : tableau de bord, données de démo) |
| `service/` | la salle : `RestaurantTable`, `Reservation`, `Seance`, `Order` / `OrderItem`, `Addition`, `Review` | ses modèles, `daily_special_stats()` (ventes et notes d'un Plat du jour) |
| `analytics/` | tableau de bord du gérant (lecture seule, sans modèle) | rien |
| `realtime/` | `broadcast()`, consumer WebSocket (sans modèle) | `broadcast` |

`inventory/` et la table du plan de salle viennent de `catalog/` : leurs tables gardent leur nom (`Meta.db_table`), et les migrations de déplacement ne changent que l'état de Django, sans aucune requête SQL ni copie de données.

---

## 3. Contrôle d'accès
- Les viewsets héritent de `RoleViewSet` (CRUD) ou de `ReadOnlyRoleViewSet` (objets qui ne changent que par des actions : Séances, Additions), tous deux dans `accounts/permissions.py`. Ils déclarent `read_roles`, `write_roles` et `action_roles`, dont chaque valeur est un tuple de rôles, `PUBLIC` ou `AUTHENTICATED`. Un tuple vide signifie « gérant uniquement » ; le gérant est toujours autorisé.
- `get_queryset` filtre en plus par rôle : le client ne voit que ses réservations, livraisons, Additions et avis ; le livreur ne voit que ses livraisons ; le stationneur ne voit que les réservations avec véhicule.

---

## 4. API REST (`/api/`)

| Endpoint | Accès | Rôle |
| :--- | :--- | :--- |
| `POST auth/register/` | public | Inscription client |
| `POST auth/token/`, `auth/token/refresh/`, `auth/logout/` | public | Connexion (jeton d'accès dans la réponse, jeton de rafraîchissement en cookie `httpOnly`), rafraîchissement par le cookie, déconnexion (révocation) |
| `POST auth/password/reset/` (`email`), `auth/password/reset/confirm/` (`uid`, `token`, `password`) | public | Mot de passe oublié : lien par e-mail valable 1 h vers `/mot-de-passe/nouveau` ; la demande répond toujours 204 (on ne révèle pas quels e-mails ont un compte) ; la confirmation vérifie le mot de passe, rend le lien inutilisable et révoque toutes les sessions du compte |
| `GET auth/me/` | connecté | Profil |
| `POST auth/me/availability/` | livreur | Début / fin de service (`AVAILABLE` ⇄ `OFFLINE`), refusé pendant une livraison ; annoncé au groupe `deliveries` |
| `users/` (`?role=&availability=`, `?staff=1` : sans les clients) | gérant (lecture : + responsable) | Personnel, livreurs disponibles |
| `job-applications/` + `accept/`, `reject/` | dépôt public, reste gérant | Candidatures |
| `suppliers/` | gérant | Fournisseurs |
| `tables/` (champs calculés `is_occupied`, `reserved_at`) | lecture connecté, écriture gérant | Plan de salle : occupée (Séance ouverte) ou réservée maintenant (une réservation pas encore installée couvre l'heure actuelle : pas de client sans réservation possible) |
| `dishes/` (`?orderable=1`) | lecture publique, écriture gérant | Carte + Recette (`ingredients`) |
| `daily-specials/` | lecture publique, écriture Chef | Plat du jour (retrait : `is_available=false`) ; chaque entrée donne aussi `sold` (portions payées ou livrées) et `rating` / `rating_count` ; date passée refusée ; un plat déjà commandé ne peut pas être supprimé (400) |
| `GET menu/` | public | Carte disponible + Plat du jour de la date |
| `ingredients/` | gestionnaire de stock | Stock, Ruptures ; chaque ingrédient liste les plats de la Carte qui l'utilisent (`dishes`) |
| `stock-requests/` + `approve/` (`supplier`), `fulfill/` | gestionnaire de stock / gérant | Réapprovisionnement ; l'auteur de la demande est prévenu en direct (`stock_request_updated`) |
| `reservations/` + `confirm_parking/`, `refuse_parking/`, `confirm/`, `reassign_table/`, `check_in/`, `no_show/`, `cancel/` | client, stationneur, responsable | UC-03 / UC-04 |
| `GET reservations/{id}/free_tables/?guests=&now=` | responsable | Tables possibles pour un changement de table ou un check-in (même Zone, places suffisantes, libres sur le créneau ; `now=1` exclut aussi les tables occupées) |
| `orders/` + `cancel/`, `assign_deliverer/`, `deliver/`, `fail/` | serveur, client, responsable, livreur | Commandes et livraisons |
| `seances/` + `pay/`, `close/` | caissier, serveur, responsable | Séances, encaissement |
| `additions/` (`?date=AAAA-MM-JJ`) + `ticket/` | caissier, client (les siennes), gérant | Paiements, ticket ; chaque Addition liste aussi ses plats, le personnel qui l'a servie et les avis déjà donnés |
| `reviews/` | client, gérant | Avis |
| `GET dashboard/` | gérant | Statistiques |

Documentation interactive : **`/api/docs/`** (Swagger UI, bouton *Authorize* avec le jeton d'accès) et schéma OpenAPI 3 sur `/api/schema/`. La CI échoue si le schéma produit un avertissement.

**Listes qui grandissent** (`reservations`, `orders`, `additions`, `seances`, `reviews`, `stock-requests`, `job-applications`, `daily-specials`, `users`) : elles ne reviennent jamais entières.

- `?scope=active` : les éléments en cours, liste simple non paginée (bornée par l'activité réelle) : réservations en attente / confirmées / installées, commandes en attente / en livraison, Séances ouvertes, Additions des 7 derniers jours (encore notables), demandes de stock en cours, candidatures en attente, Plats du jour d'aujourd'hui et planifiés.
- `?scope=history` : les terminés, du plus récent au plus ancien, paginés.
- Sans `scope` : tout, paginé.
- Pagination `limit` / `offset` (50 par défaut, 200 au plus), réponse `{count, next, previous, results}`. Un filtre qui borne déjà la liste la laisse non paginée : `additions/?date=`, `users/?role=` ou `?staff=1`.

Côté frontend, `useApi` charge les listes `active` et `usePagedApi` les historiques (20 par 20, bouton « Voir plus »).

Index ajoutés sur ce que filtrent les écrans : réservations `(status, reservation_time)`, commandes `(status, created_at)` et `(is_delivery, status)`, Séances `(status, opened_at)`, Additions `created_at`, demandes de stock `status`. Les connexions à PostgreSQL sont réutilisées 60 s (`CONN_MAX_AGE`, avec vérification de santé).

Une ligne de commande porte **soit** `dish` (Carte), **soit** `daily_special` (Plat du jour). Une commande en salle se crée avec `table_number` (+ `seance_name` facultatif pour un client sans réservation) ; une livraison avec `delivery_address`.

---

## 5. Temps réel (WebSockets)

Connexion : `POST /api/realtime/ticket/` (authentifié) renvoie un ticket aléatoire à usage unique, valable 30 s, puis `ws://<hôte>/ws/?ticket=<ticket>`. Le JWT ne passe donc jamais dans une URL, où il finirait dans les journaux des proxys. Un ticket absent, invalide, expiré ou déjà utilisé entraîne le refus de la connexion (les tickets sont dans Redis, partagés par toutes les instances). Si la demande de ticket échoue, le client réessaie avec le même délai croissant qu'après une coupure. Chaque socket rejoint les groupes de son rôle, plus un groupe personnel `user_<id>`. Format des messages : `{"event": "...", "payload": {...}}`.

| Groupe | Membres | Événements |
| :--- | :--- | :--- |
| `kitchen_pos` | caissiers, serveurs | `seance_opened`, `order_created` (salle), `order_cancelled`, `seance_closed` |
| `reservations` | responsables | `reservation_created`, `parking_confirmed`, `parking_refused`, `reservation_confirmed`, `table_reassigned`, `checked_in`, `reservation_no_show`, `reservation_cancelled` |
| `parking` | stationneurs | `parking_requested`, puis tous les événements d'une réservation avec véhicule (confirmation, annulation, no-show…) : une annulation libère la place |
| `deliveries` | responsables réservation (les livreurs ne reçoivent que leurs livraisons, via `user_<id>`) | `order_created` (livraison), `order_cancelled`, `delivery_assigned`, `order_delivered`, `delivery_failed` (le bureau voit les livreurs redevenir disponibles) |
| `manager` | gérant (abonné à tous les groupes) | `addition_paid`, `delivery_failed`, `review_created`, `stock_request_created`, `rupture_started`, `rupture_ended` |
| `user_<id>` | l'utilisateur | événements de ses réservations, `delivery_assigned`, `order_on_the_way`, `order_delivered`, `delivery_failed` |

Les envois passent par `service.events.broadcast`, qui attend `transaction.on_commit` : un état annulé par un rollback n'est jamais diffusé.

---

## 6. Règles d'implémentation clés

1. **Table proposée** (`Reservation.free_tables`) : même Zone, `capacity >= guest_count`, aucune réservation active de la table dans `±RESERVATION_SLOT` (2 h), la plus petite table d'abord. Les tables de la Zone sont verrouillées (`select_for_update`) pendant la création, le changement de table et le check-in.
2. **Séance** : au plus une Séance `OPEN` par table, garanti par une contrainte unique conditionnelle en base. Elle s'ouvre au check-in, ou à la première commande d'un serveur sur une table libre et non réservée sur le créneau à venir. « Table occupée » est calculé (Séance ouverte), pas stocké.
3. **Transitions d'état** : chaque action s'exécute dans `transaction.atomic` et verrouille la ligne via `_lock(model, pk, *statuts_attendus)`. Un statut inattendu renvoie une erreur 400, ce qui empêche double paiement, double attribution et double check-in.
4. **Addition** : `seances/{id}/pay/` encaisse toutes les commandes `PENDING` de la Séance (les commandes annulées sont exclues), passe la Séance en `PAID` et la réservation en `DONE`. Pour une livraison, l'Addition est créée par `orders/{id}/deliver/`, encaissée par le livreur.
5. **Plat disponible** : `Dish.objects.orderable()` = `is_available` et aucun ingrédient de la Recette en Rupture. Le Plat du jour n'est commandable que le jour de sa date et s'il n'a pas été retiré.
6. **Avis** : validé contre l'Addition (appartient au client, payée depuis moins de 7 jours, la cible en fait partie). L'unicité par cible et par Addition est garantie en base (`UNIQUE … NULLS NOT DISTINCT`).
7. **Suppression protégée** : supprimer un élément encore référencé (plat commandé, table avec Séances, fournisseur choisi) renvoie un 400 explicite au lieu d'une erreur 500 (`RoleViewSet.perform_destroy`).
8. **Prix figés** : `OrderItem.unit_price` copie le prix au moment de la commande ; les totaux sont calculés côté serveur.
9. **Fuseau horaire** : `TIME_ZONE` (par défaut `Africa/Algiers`). Les dates sont stockées en UTC, mais le Plat du jour change à minuit heure locale et le chiffre d'affaires est groupé par jour local.
10. **Formulaires multipart** (upload de photo) : `is_available` vaut `True` par défaut, sinon DRF lit une case absente comme `False`.

---

## 7. Frontend (`client/`)

React 19 + TypeScript (Vite), React Router, Motion. Identité visuelle : [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md).

| Route | Page |
| :--- | :--- |
| `/` | Landing (Carte et Plat du jour en direct) |
| `/connexion`, `/inscription` | Connexion (tous les rôles), inscription client |
| `/espace` | Redirige vers l'espace du rôle connecté |
| `/espace/<slug>` | Espace d'un rôle : `client`, `reservations`, `parking`, `salle`, `caisse`, `livraison`, `chef`, `stock`, `gerant`. Un rôle n'ouvre que le sien, le gérant les ouvre tous. |

- **API** : tous les chemins sont dans `src/api.ts` (`ENDPOINTS`). `api()` ajoute le JWT et, sur un 401, rafraîchit le jeton une fois puis rejoue la requête ; les rafraîchissements simultanés partagent une seule requête.
- **Session** : le jeton d'accès (5 min) reste en mémoire. Le jeton de rafraîchissement (1 jour) n'est jamais exposé au JavaScript : la connexion le pose dans un cookie `httpOnly`, `SameSite=Strict`, `Secure` en production, limité au chemin `/api/auth/`. `auth/token/refresh/` le lit dans ce cookie ; `auth/logout/` le révoque (liste noire SimpleJWT) et supprime le cookie, donc un jeton volé ne sert plus après la déconnexion. `localStorage` ne garde qu'un indicateur non secret « une session existe », pour éviter un rafraîchissement inutile aux visiteurs anonymes.
- **Temps réel** : `useRealtime()` ouvre un WebSocket par utilisateur connecté, avec un jeton fraîchement rafraîchi à chaque (re)connexion et une reconnexion progressive (1 s → 30 s). `useLiveRefresh()` recharge les données à chaque événement **et après chaque reconnexion** (les événements envoyés pendant une coupure sont perdus).
- **Redis** : `redis>=5,<8` est épinglé. redis-py 8 lève une erreur sur la lecture bloquante de 5 s de channels_redis (`BZPOPMIN`), ce qui fermait chaque WebSocket inactif au bout de 5 s (code 1011). Un test couvre ce cas.
- **Espace client** (`/espace/client?onglet=…`) : réserver (créneaux 12h–13h et 19h–21h, lundi refusé côté interface, table proposée affichée), commander en livraison (panier depuis le Menu), suivre et annuler réservations et commandes, noter les Additions (cibles issues de l'Addition, 7 jours). Chaque événement personnel (`user_<id>`) recharge les listes et s'affiche en notification.
- **Espace réservations** (`/espace/reservations`) : onglets Aujourd'hui / À valider / À venir / Livraisons / Historique avec compteurs ; confirmer, changer de table (tables proposées par `free_tables`), check-in avec correction du nombre de personnes, no-show une fois l'heure passée ; livraisons à attribuer, état des livreurs et livraisons en route, le tout en direct.
- **Espace salle** (`/espace/salle?table=N`) : plan de salle par Zone (libre, occupée avec nom et montant dû, réservée bientôt) ; une table ouvre son panneau : commandes de la Séance (annulation en deux temps), nouvelle commande depuis le Menu (avec nom facultatif pour un client sans réservation), clôture d'une Séance sans commande. Check-ins et paiements arrivent en direct.
- **Espace stock** (`/espace/stock`) : ingrédients (Ruptures en tête, quantités modifiables, plats concernés), rupture confirmée en voyant les plats retirés du Menu, raccourci vers une demande de réapprovisionnement, suivi des demandes en direct.
- **Espace gérance** (`/espace/gerant`) : tableau de bord (chiffre d'affaires du jour en chiffre principal, indicateurs, colonnes du chiffre d'affaires sur 14 jours et barres des plus vendus avec infobulles et vue tableau, notes, flux en direct), équipe (création et désactivation des comptes, candidatures), Carte (plats, Recettes, retrait), réapprovisionnement (approbation avec fournisseur, réception), tables et fournisseurs.
- **Chargement à la demande** : chaque espace est un module séparé (`React.lazy`), un rôle ne télécharge que le sien.
- **Espace chef** (`/espace/chef`) : plat du jour d'aujourd'hui (photo, prix, servis, note ; « épuisé » le retire du Menu, et on peut le remettre), planification des jours suivants (une date par plat), historique avec portions servies et notes. Envoi de la photo en multipart (`FormData`) ; la page d'accueil affiche la photo du Chef quand il y en a une.
- **Espace livreur** (`/espace/livraison`, pensé pour mobile) : statut et début / fin de service, livraison en cours (client, adresse avec itinéraire, appel, plats, montant à encaisser), « livrée et encaissée » (espèces ou carte) ou « livraison échouée », historique récent.
- **Espace caisse** (`/espace/caisse`) : tables à encaisser (lignes et montant dû, en direct), encaissement en espèces ou par carte, puis ticket dans une fenêtre `<dialog>` ; l'impression (`@media print`) ne sort que le ticket, au format 80 mm. Onglet « Encaissements du jour » : totaux espèces / carte et réimpression.
- **Espace parking** (`/espace/parking`) : demandes en attente (garder une place, avec les places déjà prises sur le créneau, ou « parking complet ») et places gardées à venir, en direct.
- **Briques partagées** (`src/ui/`) : `Tabs` + `useTab` (onglet dans l'URL), `Toast`, `Loading`, `MenuPicker` + `menu.ts` (choix des plats avec quantités, panier) ; `useLiveRefresh(refresh, notifications)` dans `realtime.ts` recharge les données à chaque événement et traduit ceux qui comptent en notification.
- Les neuf rôles ont leur espace ; `CONTENT` dans `pages/SpacePage.tsx` associe chaque rôle à son module.
- **Langue** : `LANGUAGE_CODE = 'fr'` côté Django, pour que les messages de validation (mot de passe, champs) arrivent en français dans les formulaires.

## 8. Lancer et tester (depuis `server/`)

```bash
docker compose up --build                              # depuis la racine : toute la pile sur http://localhost:8088

# ou, pour développer le backend :
docker compose up -d postgres redis
../venv/Scripts/python.exe -m pip install -r requirements.txt
../venv/Scripts/python.exe manage.py migrate
../venv/Scripts/python.exe manage.py seed_demo         # restaurant de démo ; ne crée que ce qui manque (relancé à chaque démarrage Docker sans écraser les modifications)
../venv/Scripts/python.exe manage.py runserver         # HTTP + WebSocket (Daphne)
../venv/Scripts/python.exe manage.py test              # PostgreSQL et Redis doivent tourner
```

Les tests de `service/tests.py` sont regroupés par domaine : réservations, Séances, livraisons, Menu et stock, avis, comptes, temps réel, sécurité (limites, réinitialisation du mot de passe, administration).

**Parcours de bout en bout** (`e2e/`, Playwright) sur la pile Docker complète, chaque rôle dans sa propre session :

- **Salle** : un nouveau client s'inscrit et réserve ; le responsable (écran déjà ouvert) confirme et installe ; le serveur commande ; la caisse (écran déjà ouvert) encaisse par carte et le ticket s'affiche.
- **Livraison** : le client commande ; le responsable attribue le livreur ; le téléphone du livreur reçoit la course, il la livre et l'encaisse ; la commande du client passe à « Livrée ».
- **Stock** : une Rupture retire le plat du Menu public et apparaît en direct chez le gérant ; la fin de rupture le remet.

Les écrans qui reçoivent sont ouverts avant l'action : ce qui y apparaît sans rechargement prouve le temps réel. `RATE_LIMIT_SCALE=100` multiplie les limites de débit sur cette pile (une seule IP joue les neuf rôles) ; `BASE_URL` vise un autre environnement (jamais la production : les parcours créent des données). En CI, le job `e2e` monte la pile, attend `/healthz/`, lance les parcours et joint le rapport en cas d'échec ; le job `frontend` vérifie le lint, les types et le build.

---

### Image de production

`server/Dockerfile` construit une image qui applique les migrations, crée le restaurant de démo (`seed_demo`) puis lance Daphne sur `$PORT` (8000 par défaut). Les fichiers statiques (admin) sont servis par WhiteNoise. Avec `DEBUG=0`, `SECRET_KEY` est obligatoire, les cookies sont sécurisés, le HTTPS est détecté derrière le proxy de l'hébergeur (`X-Forwarded-Proto`), HTTP est redirigé vers HTTPS (sauf `/healthz/`) et HSTS est envoyé (1 an). Variables : voir `server/.env.example`.

### Démo en ligne

- **Frontend** : Vercel ([resto-ruby-nine.vercel.app](https://resto-ruby-nine.vercel.app)). `client/vercel.json` réécrit `/api` et `/media` vers l'API : le navigateur reste sur une seule origine, donc le cookie de rafraîchissement `SameSite=Strict` fonctionne. Vercel ne relaie pas les WebSockets : le build reçoit `VITE_WS_URL` (domaine de l'API) et le socket s'y connecte directement, avec le jeton en paramètre.
- **API** : Render, image Docker de `server/` décrite par `render.yaml`. `ALLOWED_HOSTS` contient aussi le domaine Vercel, car le validateur d'origine des WebSockets le compare à l'en-tête `Origin`.
- **Base de données** : PostgreSQL Supabase via le pooler de session (IPv4), `POSTGRES_SSLMODE=require`. L'API de données Supabase est désactivée : seules les requêtes de Django atteignent les tables.
- **Photos** : Supabase Storage par le protocole S3 (`django-storages`), bucket public `media` ; sans `S3_BUCKET`, les photos restent dans `media/`.
- **Redis** : l'instance Key Value gratuite du compte Render, partagée avec un autre projet sur son propre index (`REDIS_DB=1`).

### Sécurité et exploitation

- **Limitation de débit** (DRF, compteurs dans Redis) : 120 requêtes/min par IP anonyme, 600/min par utilisateur, et par IP : connexion 10/min, rafraîchissement 30/min, inscription 20/h, candidature 10/h. Au-delà : `429`. `NUM_PROXIES=2` en production (Vercel puis Render) pour compter la vraie IP du client dans `X-Forwarded-For`.
- **Santé** : `GET /healthz/` renvoie `{"database": "ok", "redis": "ok"}` ; `503` seulement si la base est injoignable (sans Redis l'API fonctionne, sans temps réel). C'est le contrôle de santé de Render.
- **E-mails** : SMTP si `EMAIL_HOST` est défini (`EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`), sinon affichés dans les journaux. `FRONTEND_URL` construit les liens. Les comptes de démo ont des adresses `@resto.demo` qui ne reçoivent rien : personne ne peut réinitialiser leur mot de passe.
- **Administration Django** : réservée au rôle gérant (même un compte `is_staff` d'un autre rôle est refusé), bloquée 15 min après 5 échecs de connexion depuis une IP (429), sessions de 12 h. Elle n'est servie que sur le domaine de l'API (pas via Vercel), et coupée sur la démo publique (`ADMIN_ENABLED=0`), dont le mot de passe gérant est publié. En production réelle : un superutilisateur distinct, au mot de passe privé.
- **Surveillance** (`.github/workflows/uptime.yml`, toutes les heures) : vérifie `/healthz/` (base et Redis), le site et l'API à travers le site, avec 3 tentatives (l'instance gratuite met environ une minute à se réveiller). En cas de panne, ouvre une issue GitHub `uptime` (ou la complète) et GitHub envoie un e-mail sur l'échec ; l'issue se ferme toute seule au retour. Une fois par heure seulement : chaque contrôle réveille l'instance Render, dont les 750 heures gratuites par mois sont partagées par tout l'espace de travail. Test de l'alerte : lancer le workflow à la main avec `simulate_failure`.
- **Erreurs** : Sentry, actif seulement si `SENTRY_DSN` (API) ou `VITE_SENTRY_DSN` (build du frontend) est défini ; aucune donnée personnelle envoyée. Sans DSN au build, le code Sentry n'est même pas inclus.
- **En-têtes du frontend** (`client/vercel.json`) : Content-Security-Policy (scripts du site seulement ; images Unsplash et Supabase ; polices Google ; WebSocket vers l'API ; Sentry), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.

## 9. Surveillance des tables (`monitoring/` + `vision/`)

Réservée au **gérant** et au **responsable des réservations**. Un module de plus, qui **lit** le cœur sans jamais le modifier : une Séance ou une réservation ne change que par ses actions habituelles. Si une caméra tombe, le restaurant fonctionne exactement comme avant (`monitoring/api.py` n'expose rien : aucun module ne dépend des caméras).

**Chaîne de traitement** (le *vision worker*, un service à part dans `vision/`, sur le lieu de la caméra) :

1. **Détection** : YOLO26 pose (`yolo26n-pose`) trouve chaque personne et ses 17 points du corps.
2. **Suivi** : DeepSORT garde le même identifiant à une personne d'une image à l'autre (filtre de Kalman + apparence MobileNet), pour qu'une personne cachée un instant ne fasse pas varier le compte.
3. **Assis ou debout** : genoux presque à hauteur des hanches = assis ; jambes cachées sous la table = forme de la boîte. Seules les personnes assises comptent (un serveur debout à côté d'une table n'est pas un client).
4. **Table** : le point entre les hanches est dans le polygone de la table (fractions de l'image, configuré sur le serveur).
5. **Lissage** : médiane des comptes sur quelques secondes, puis attente avant de changer d'état (4 s pour « occupée », 20 s pour « vide » : un client peut s'absenter).
6. **Floutage** : un flou doux et transparent en forme de personne (ellipse aux bords fondus) : léger sur le corps, on devine une silhouette ; fort sur la tête, aucun visage n'est reconnaissable. Toute personne détectée (seuil bas, 10 %) ou seulement prédite par le suivi est floutée avant que l'image ne quitte le worker, plus des **masques de confidentialité** toujours floutés (fond de salle, passage, vitrine sur la rue). En cas d'erreur, une image noire, jamais l'image brute. Sur la vidéo, chaque table est dessinée par le contour de son plateau (vert libre, or occupée) avec une étiquette « T3 2/4 ».
7. **Fluidité** : trois fils d'exécution. Le lecteur garde toujours l'image la plus récente de la caméra ; l'affichage (détection YOLO + flou + diffusion) tourne aussi vite que le processeur le permet (jusqu'à 25 images/s) et ne dépend jamais du suivi ; l'analyse (DeepSORT, comptage, envoi) tourne à son rythme (5 fois/s), sur les dernières détections.
8. **Envoi** : `{table, personnes, occupée, depuis}` à l'API toutes les 3 s (et à chaque changement). Le flux vidéo flouté (MJPEG) n'est servi qu'avec un ticket signé.

**Côté API** :

| Endpoint | Accès | Rôle |
| :--- | :--- | :--- |
| `GET monitoring/tables/` | gérant, responsable | Chaque table : l'état du cœur (`is_occupied`, `reserved_at`, `seance_name`) et, si la lecture a moins de 30 s, ce que voit la caméra (`people`, `occupied`) |
| `GET monitoring/cameras/` | gérant, responsable | Caméras, en ligne ou non, flux en direct possible ou séquence de démonstration |
| `POST monitoring/cameras/{slug}/stream/` | gérant, responsable | URL du flux flouté, signée HMAC, valable 60 s (le worker vérifie la signature avec le secret partagé `MONITORING_STREAM_SECRET`) |
| `GET monitoring/device/config/`, `POST monitoring/device/observations/` | worker (`Authorization: Device <jeton>`) | Zones et masques de la caméra ; envoi des lectures. Seule l'empreinte SHA-256 du jeton est stockée |
| `GET`/`POST monitoring/setup/cameras/` | gérant | Toutes les caméras avec leurs zones et masques (3 requêtes quel que soit leur nombre) ; ajout d'une caméra (le jeton n'apparaît qu'une fois, dans la réponse) |
| `PATCH`/`DELETE monitoring/setup/cameras/{slug}/` | gérant | Nom, zone, activation, masques ; `zones` remplace toutes les tables de la caméra d'un coup |
| `POST monitoring/setup/cameras/{slug}/token/` | gérant | Nouveau jeton, l'ancien cesse de marcher |

Une lecture écrase la précédente (une ligne par table, **aucun historique**). L'envoi d'un lot coûte 7 requêtes quel que soit le nombre de tables (pas de N+1 : une lecture des anciennes valeurs, un `bulk_create` en *upsert*), vérifié par un test. Un changement est poussé en direct (`monitoring_update`, groupe `reservations`, que rejoint aussi le gérant).

**Plusieurs caméras** (plusieurs zones, grande salle) : chaque caméra couvre une **zone** du restaurant que le gérant nomme librement : « Salle VIP », « Salle front de mer », « Terrasse » (`Camera.area`) ; elle a ses zones de tables et son propre worker. Une table n'est suivie que par **une** caméra (`TableZone.table` est unique ; l'API refuse une table déjà prise en nommant sa caméra) : là où deux champs se recouvrent, personne n'est compté deux fois. L'onglet Surveillance filtre par zone puis par caméra ; `monitoring/tables/` indique `camera_slug` pour chaque table.

**Configuration** (onglet **Caméras** du gérant) : ajouter une caméra (nom, identifiant, zone) donne son jeton, à copier dans le worker. Sur une image fixe floutée de la caméra (`/stream/<slug>/snapshot.jpg`, même ticket signé que le flux ; sinon la séquence de démonstration), le gérant clique les coins de chaque zone de comptage (la table et ses chaises), du plateau (pour le dessin) et des masques de confidentialité. Les coordonnées sont enregistrées en fractions de l'image. Le worker relit sa configuration chaque minute (`CONFIG_EVERY`) : un changement s'applique sans redémarrage. `manage.py monitoring_camera` reste disponible pour une installation scriptée.

**Couleur d'une table** (le cœur décide toujours en premier) : Séance ouverte → **Occupée** (encre, avec le nombre vu par la caméra) ; réservation en cours → **Réservée** (crème et or), ou **Clients arrivés ?** si la caméra voit des personnes assises (à installer au check-in) ; sinon personnes assises sans Séance → **Sans séance** (danger : quelqu'un doit s'en occuper) ; sinon **Libre**. Une table de 3 avec 2 clients est occupée : la place libre n'est pas proposée.

**Déploiement** : `docker compose --profile vision up` lance le worker (image CPU, environ 8 images/s ; avec `-f docker-compose.gpu.yml`, PyTorch CUDA sur une carte NVIDIA, environ 25 images/s ; modèle et clip de démonstration téléchargés à la construction et vérifiés par SHA-256 ; utilisateur non root ; `/healthz` et `/metrics`). Un worker par caméra, nommé `vision-<slug>` : nginx envoie `/stream/<slug>/…` vers `http://vision-<slug>:8090` (le service de démo s'appelle `vision-salle` ; une zone de plus = une copie de ce service avec son `VIDEO_SOURCE` et son jeton). Une caméra réelle : `VIDEO_SOURCE=rtsp://…`, `DEVICE=cuda:0` pour un GPU, zones et masques dessinés dans l'onglet Caméras. Sur la démo publique, aucun worker ne tourne : l'écran rejoue `client/public/monitoring/demo.mp4` (flouté à l'avance) avec `timeline.json`, produits par `python -m resto_vision render`.

**Confidentialité** : la salle est déclarée sous vidéosurveillance (pied de page du site, formulaire de réservation), conformément à la loi 18-07 ; aucune image n'est enregistrée, aucune reconnaissance faciale, seuls des nombres sortent du worker.

## 10. Évolutions prévues
Flux cuisine pour le Chef, Addition partagée.
