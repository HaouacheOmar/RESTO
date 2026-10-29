# RESTO

[![tests](https://github.com/HaouacheOmar/RESTO/actions/workflows/tests.yml/badge.svg)](https://github.com/HaouacheOmar/RESTO/actions/workflows/tests.yml) [![uptime](https://github.com/HaouacheOmar/RESTO/actions/workflows/uptime.yml/badge.svg)](https://github.com/HaouacheOmar/RESTO/actions/workflows/uptime.yml)

A distributed restaurant management system. Every role in the restaurant (manager, reservation desk, chef, waiters, cashier, delivery drivers, parking attendant, stock keeper) and its clients work on the same live state: a reservation, an order or a payment shows up instantly on the screens that need it.

[![RESTO showcase video: one evening across the nine role spaces (45 s)](docs/media/RESTO.jpg)](docs/media/RESTO.mp4)

*Showcase (45 s): one evening, from booking to receipt, across the nine role spaces. Click the image to play.*

**Live demo: [resto-ruby-nine.vercel.app](https://resto-ruby-nine.vercel.app)**. Sign in with any demo account below (password `demo-resto-2026`). The API runs on a free instance that sleeps when idle, so the first request can take up to a minute.

## Features

- **Reservations**: automatic table proposal (zone, party size, 2-hour slots), parking spot handling, check-in, no-shows.
- **Table sessions**: a *Séance* opens at check-in or for a walk-in; waiters add as many orders as needed and the cashier collects one bill (*Addition*) for the whole table, then prints the receipt.
- **Delivery**: clients order online, the desk assigns an available driver, the driver collects payment or reports a failed delivery.
- **Menu**: permanent *Carte* with recipes (a dish becomes unavailable when an ingredient runs out) plus a daily dish set by the chef.
- **Stock**: shortages, restock requests, supplier selection.
- **Reviews and dashboard**: clients rate what they actually had within 7 days; the manager sees revenue, best sellers, staff ratings and incidents.
- **Real time**: WebSocket notifications per role, authenticated with the same JWT as the API.
- **Table monitoring** (manager and reservation desk): a camera counts the guests seated at each table (YOLO26 pose + DeepSORT) and the screen shows the blurred CCTV next to a table map coloured by status, with *people / capacity*. Everyone is blurred at the source and no image is stored. See [`vision/`](vision/).

## Architecture

```
  Clients (web / mobile)  ── HTTPS REST + JWT ──┐
                          ── WebSocket ─────────┤
                                                ▼
                     Daphne (ASGI): Django + DRF │ Channels consumer
        accounts · catalog · inventory · service · analytics · realtime
                                │                     │
                           PostgreSQL          Redis (channel layer)
```

| Layer | Tech |
| :--- | :--- |
| API | Python 3.12, Django 6.1, Django REST Framework, JWT (simplejwt) |
| Real time | Django Channels, Daphne, Redis |
| Database | PostgreSQL 17 (business rules enforced with constraints and row locks) |
| Docs | OpenAPI 3 / Swagger UI (drf-spectacular) |
| Frontend | React 19, TypeScript, Vite, Motion; served by nginx |
| CI | GitHub Actions (tests, schema validation, Docker builds) |

## Quick start

Requires Docker only.

```bash
docker compose up --build
```

Then open **http://localhost:8088**. The stack starts PostgreSQL, Redis, the Django/Daphne backend (migrations and demo data applied on startup) and the React frontend served by nginx, which also proxies the API, the admin and the WebSockets on the same origin.

- **http://localhost:8088/**: landing page (live menu and dish of the day).
- **http://localhost:8088/api/docs/**: interactive API (log in with `POST /api/auth/token/`, then *Authorize*).
- **http://localhost:8088/admin/**: back office (`manager` account). It's switched off on the public demo, where the manager password is published (`ADMIN_ENABLED=0`).
- **ws://localhost:8088/ws/?ticket=<ticket>**: live events for the logged-in role (get a single-use ticket from `POST /api/realtime/ticket/`).

Demo accounts: `manager`, `reservations`, `chef`, `waiter`, `cashier`, `driver`, `parking`, `stock`, `client`, all with the password `demo-resto-2026`.

### Developing without rebuilding images

```bash
docker compose up -d postgres redis        # PostgreSQL :5434, Redis :6380
cd server && python -m venv ../venv && source ../venv/bin/activate   # Windows: ..\venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate && python manage.py seed_demo
python manage.py runserver                 # API on :8000
cd ../client && npm install && npm run dev # app on :5173, proxied to the API
```

Run the backend tests (PostgreSQL and Redis up): `cd server && python manage.py test`.

End-to-end journeys (Playwright) across the role spaces, against the whole stack:

```bash
RATE_LIMIT_SCALE=100 docker compose up -d --build   # one IP plays all nine roles: raise the rate limits
cd e2e && npm ci && npx playwright install chromium
npx playwright test                                 # BASE_URL=https://staging… to target another environment
```

CI runs the backend tests, the module boundaries (`lint-imports`), the frontend lint and build, and these journeys on a throwaway Docker stack.

## Documentation

- [`CONTEXT.md`](CONTEXT.md): domain glossary (Séance, Addition, Carte, Plat du jour, Rupture…).
- [`docs/PRD.md`](docs/PRD.md): roles and use cases.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md): architecture, endpoints, WebSocket events, key rules.
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md): data model and constraints.
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md): visual identity, components and motion rules for the frontend.

The specs are written in French, like the restaurant's vocabulary.

## Deployment

| Part | Host |
| :--- | :--- |
| Frontend | Vercel (`client/`, `client/vercel.json` forwards `/api` and `/media` to the API) |
| API + WebSockets | Render, Docker image from `server/` (`render.yaml`); the app opens WebSockets on the API's own domain (`VITE_WS_URL`) |
| Database | Supabase PostgreSQL, through the session pooler (`POSTGRES_SSLMODE=require`) |
| Dish photos | Supabase Storage, S3 protocol (`S3_*` variables) |
| Redis | Render Key Value (the free instance, shared on its own db index: `REDIS_DB`) |

The container applies migrations and creates the demo restaurant on start (`SEED_DEMO=0` turns that off). Variables: `server/.env.example`.

**For a real restaurant** (one Linux server, e.g. an Icosnet VM): `docker-compose.prod.yml` adds HTTPS (Caddy), no demo data, required secrets, restart policies and daily backups. Step-by-step guide (French): [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Roadmap

Backend first, then one frontend space per role: see the [issues](https://github.com/HaouacheOmar/RESTO/issues).
