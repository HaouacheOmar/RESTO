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

Tout se lance avec `docker compose up --build` à la racine (`docker-compose.yml`) : PostgreSQL, Redis, le backend (Daphne) et le frontend React servi par nginx sur **http://localhost:8080**. nginx sert l'application et relaie `/api`, `/admin`, `/static`, `/media` et `/ws` vers Django : tout est sur la même origine. En développement, PostgreSQL et Redis seuls (`docker compose up -d postgres redis`, ports hôte 5434 et 6380) et Django dans le `venv/` à la racine.

---

## 2. Architecture

```
  Espaces clients (web / mobile / PWA)
  gérant · réservation · chef · serveur · caisse · livreur · stationneur · stock · client
         │  HTTPS (REST + JWT)            │  WebSocket ws://…/ws/?token=<JWT>
         ▼                                ▼
  ┌───────────────────────────────────────────────────────┐
  │ Daphne (ASGI) — config/asgi.py                         │
  │   http → Django + DRF        websocket → Consumer       │
  │  accounts   catalog   service                          │
  └──────────────┬──────────────────────────┬─────────────┘
                 ▼                          ▼
           PostgreSQL                 Redis (channel layer)
```

Le système est distribué au sens où plusieurs postes indépendants partagent un état central et reçoivent des notifications en temps réel. Le channel layer Redis permet de lancer plusieurs instances Daphne derrière un load balancer sans changer le code.

| App | Contenu |
| :--- | :--- |
| `config/` | settings (variables d'environnement), routes, ASGI |
| `accounts/` | `User` (rôle, disponibilité), `JobApplication`, permissions par rôle, middleware JWT WebSocket |
| `catalog/` | `Supplier`, `RestaurantTable`, `Dish` (Carte + Recette), `DailySpecial` (Plat du jour), `Ingredient`, `StockRequest` |
| `service/` | `Reservation`, `Seance`, `Order` / `OrderItem`, `Addition`, `Review`, dashboard, consumer, `broadcast` |

---

## 3. Contrôle d'accès
- Les viewsets héritent de `RoleViewSet` (CRUD) ou de `ReadOnlyRoleViewSet` (objets qui ne changent que par des actions : Séances, Additions), tous deux dans `accounts/permissions.py`. Ils déclarent `read_roles`, `write_roles` et `action_roles`, dont chaque valeur est un tuple de rôles, `PUBLIC` ou `AUTHENTICATED`. Un tuple vide signifie « gérant uniquement » ; le gérant est toujours autorisé.
- `get_queryset` filtre en plus par rôle : le client ne voit que ses réservations, livraisons, Additions et avis ; le livreur ne voit que ses livraisons ; le stationneur ne voit que les réservations avec véhicule.

---

## 4. API REST (`/api/`)

| Endpoint | Accès | Rôle |
| :--- | :--- | :--- |
| `POST auth/register/`, `auth/token/`, `auth/token/refresh/` | public | Inscription client, JWT |
| `GET auth/me/` | connecté | Profil |
| `users/` (`?role=&availability=`) | gérant (lecture : + responsable) | Personnel, livreurs disponibles |
| `job-applications/` + `accept/`, `reject/` | dépôt public, reste gérant | Candidatures |
| `suppliers/` | gérant | Fournisseurs |
| `tables/` (champ calculé `is_occupied`) | lecture connecté, écriture gérant | Plan de salle |
| `dishes/` (`?orderable=1`) | lecture publique, écriture gérant | Carte + Recette (`ingredients`) |
| `daily-specials/` | lecture publique, écriture Chef | Plat du jour (retrait : `is_available=false`) |
| `GET menu/` | public | Carte disponible + Plat du jour de la date |
| `ingredients/` | gestionnaire de stock | Stock, Ruptures |
| `stock-requests/` + `approve/` (`supplier`), `fulfill/` | gestionnaire de stock / gérant | Réapprovisionnement |
| `reservations/` + `confirm_parking/`, `refuse_parking/`, `confirm/`, `reassign_table/`, `check_in/`, `no_show/`, `cancel/` | client, stationneur, responsable | UC-03 / UC-04 |
| `orders/` + `cancel/`, `assign_deliverer/`, `deliver/`, `fail/` | serveur, client, responsable, livreur | Commandes et livraisons |
| `seances/` + `pay/`, `close/` | caissier, serveur, responsable | Séances, encaissement |
| `additions/` + `ticket/` | caissier, client (les siennes), gérant | Paiements, ticket |
| `reviews/` | client, gérant | Avis |
| `GET dashboard/` | gérant | Statistiques |

Documentation interactive : **`/api/docs/`** (Swagger UI, bouton *Authorize* avec le JWT) et schéma OpenAPI 3 sur `/api/schema/`. La CI échoue si le schéma produit un avertissement.

Une ligne de commande porte **soit** `dish` (Carte), **soit** `daily_special` (Plat du jour). Une commande en salle se crée avec `table_number` (+ `seance_name` facultatif pour un client sans réservation) ; une livraison avec `delivery_address`.

---

## 5. Temps réel (WebSockets)

Connexion : `ws://<hôte>/ws/?token=<JWT access>`. Un jeton absent ou invalide entraîne le refus de la connexion. Chaque socket rejoint les groupes de son rôle, plus un groupe personnel `user_<id>`. Format des messages : `{"event": "...", "payload": {...}}`.

| Groupe | Membres | Événements |
| :--- | :--- | :--- |
| `kitchen_pos` | caissiers, serveurs | `seance_opened`, `order_created` (salle), `order_cancelled`, `seance_closed` |
| `reservations` | responsables | `reservation_created`, `parking_confirmed`, `parking_refused`, `reservation_confirmed`, `table_reassigned`, `checked_in`, `reservation_no_show`, `reservation_cancelled` |
| `parking` | stationneurs | `parking_requested` |
| `deliveries` | responsables réservation (les livreurs ne reçoivent que leurs livraisons, via `user_<id>`) | `order_created` (livraison), `order_cancelled` |
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
7. **Prix figés** : `OrderItem.unit_price` copie le prix au moment de la commande ; les totaux sont calculés côté serveur.
8. **Fuseau horaire** : `TIME_ZONE` (par défaut `Africa/Algiers`). Les dates sont stockées en UTC, mais le Plat du jour change à minuit heure locale et le chiffre d'affaires est groupé par jour local.
9. **Formulaires multipart** (upload de photo) : `is_available` vaut `True` par défaut, sinon DRF lit une case absente comme `False`.

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
- **Session** : jeton d'accès (5 min) en mémoire, jeton de rafraîchissement (1 jour) dans `localStorage` pour survivre à un rechargement. Limite connue : lisible en cas de XSS ; l'évolution est un cookie `httpOnly` côté backend.
- **Temps réel** : `useRealtime()` ouvre un WebSocket par utilisateur connecté, avec un jeton fraîchement rafraîchi à chaque (re)connexion et une reconnexion progressive (1 s → 30 s). Chaque espace affiche le flux « Activité en direct ».
- **Langue** : `LANGUAGE_CODE = 'fr'` côté Django, pour que les messages de validation (mot de passe, champs) arrivent en français dans les formulaires.

## 8. Lancer et tester (depuis `server/`)

```bash
docker compose up --build                              # depuis la racine : toute la pile sur http://localhost:8080

# ou, pour développer le backend :
docker compose up -d postgres redis
../venv/Scripts/python.exe -m pip install -r requirements.txt
../venv/Scripts/python.exe manage.py migrate
../venv/Scripts/python.exe manage.py seed_demo         # restaurant de démo : un compte par rôle, tables, Carte, Plat du jour
../venv/Scripts/python.exe manage.py runserver         # HTTP + WebSocket (Daphne)
../venv/Scripts/python.exe manage.py test              # PostgreSQL et Redis doivent tourner
```

Les tests de `service/tests.py` sont regroupés par domaine : réservations, Séances, livraisons, Menu et stock, avis, comptes, temps réel.

---

### Image de production

`server/Dockerfile` construit une image qui applique les migrations puis lance Daphne sur `$PORT` (8000 par défaut). Les fichiers statiques (admin) sont servis par WhiteNoise. Avec `DEBUG=0`, `SECRET_KEY` est obligatoire, les cookies sont sécurisés et le HTTPS est détecté derrière le proxy de l'hébergeur (`X-Forwarded-Proto`). Variables : voir `server/.env.example`.

## 9. Évolutions prévues
Frontend, stockage des photos sur S3 ou Cloudinary, OpenAPI, CI, déploiement, flux cuisine pour le Chef, Addition partagée.
