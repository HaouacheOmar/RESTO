# RESTO

[![tests](https://github.com/HaouacheOmar/RESTO/actions/workflows/tests.yml/badge.svg)](https://github.com/HaouacheOmar/RESTO/actions/workflows/tests.yml)

A distributed restaurant management system. Every role in the restaurant (manager, reservation desk, chef, waiters, cashier, delivery drivers, parking attendant, stock keeper) and its clients work on the same live state: a reservation, an order or a payment shows up instantly on the screens that need it.

## Features

- **Reservations**: automatic table proposal (zone, party size, 2-hour slots), parking spot handling, check-in, no-shows.
- **Table sessions**: a *Séance* opens at check-in or for a walk-in; waiters add as many orders as needed and the cashier collects one bill (*Addition*) for the whole table, then prints the receipt.
- **Delivery**: clients order online, the desk assigns an available driver, the driver collects payment or reports a failed delivery.
- **Menu**: permanent *Carte* with recipes (a dish becomes unavailable when an ingredient runs out) plus a daily dish set by the chef.
- **Stock**: shortages, restock requests, supplier selection.
- **Reviews and dashboard**: clients rate what they actually had within 7 days; the manager sees revenue, best sellers, staff ratings and incidents.
- **Real time**: WebSocket notifications per role, authenticated with the same JWT as the API.

## Architecture

```
  Clients (web / mobile)  ── HTTPS REST + JWT ──┐
                          ── WebSocket ─────────┤
                                                ▼
                     Daphne (ASGI): Django + DRF │ Channels consumer
                          accounts · catalog · service
                                │                     │
                           PostgreSQL          Redis (channel layer)
```

| Layer | Tech |
| :--- | :--- |
| API | Python 3.12, Django 6.1, Django REST Framework, JWT (simplejwt) |
| Real time | Django Channels, Daphne, Redis |
| Database | PostgreSQL 17 (business rules enforced with constraints and row locks) |
| Docs | OpenAPI 3 / Swagger UI (drf-spectacular) |
| CI | GitHub Actions (tests + schema validation) |

## Quick start

Requires Python 3.12 and Docker.

```bash
cd server
docker compose up -d                       # PostgreSQL :5434, Redis :6380
python -m venv ../venv && source ../venv/bin/activate   # Windows: ..\venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo                 # demo restaurant, one account per role
python manage.py runserver
```

Then open:
- **http://localhost:8000/api/docs/**: interactive API (log in with `POST /api/auth/token/`, then *Authorize*).
- **http://localhost:8000/admin/**: back office (`manager` account).
- **ws://localhost:8000/ws/?token=<access token>**: live events for the logged-in role.

Demo accounts: `manager`, `reservations`, `chef`, `waiter`, `cashier`, `driver`, `parking`, `stock`, `client`; the password is printed by `seed_demo`.

Run the tests (PostgreSQL and Redis must be up): `python manage.py test`.

## Documentation

- [`CONTEXT.md`](CONTEXT.md): domain glossary (Séance, Addition, Carte, Plat du jour, Rupture…).
- [`docs/PRD.md`](docs/PRD.md): roles and use cases.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md): architecture, endpoints, WebSocket events, key rules.
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md): data model and constraints.

The specs are written in French, like the restaurant's vocabulary.

## Roadmap

Backend first, then one frontend space per role: see the [issues](https://github.com/HaouacheOmar/RESTO/issues).
