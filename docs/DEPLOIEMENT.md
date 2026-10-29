# Déploiement en production

Installer RESTO pour un vrai restaurant, sur **un serveur Linux** : une VM cloud chez Icosnet, ou chez n'importe quel autre hébergeur. Toute l'application tourne avec `docker/docker-compose.prod.yml`.

Ce qu'il faut louer chez l'hébergeur (serveur GPU, VPN, dimensionnement) : [HEBERGEMENT.md](HEBERGEMENT.md).

Le fichier `docker/docker-compose.yml` reste celui du poste de développement : la démo locale sur `http://localhost:8088`, avec les comptes de démonstration.

| | Local (`docker/docker-compose.yml`) | Production (`docker/docker-compose.prod.yml`) |
| :--- | :--- | :--- |
| Adresse | `http://localhost:8088` | `https://<domaine>` (certificat Let's Encrypt automatique, Caddy) |
| Données de démo | oui (`SEED_DEMO=1`, mot de passe public) | **non** (`SEED_DEMO=0`) ; le gérant est créé avec `createsuperuser` |
| Secrets | valeurs locales par défaut | **obligatoires** dans `.env` (refus de démarrer sinon) |
| Ports ouverts | 8088, 5434, 6380 | 80 et 443 seulement |
| Redémarrage après panne ou reboot | non | oui (`restart: unless-stopped`) |
| Sauvegardes | non | base + photos chaque jour, gardées 14 jours, dans `backups/` |

Toutes les commandes de ce guide se lancent depuis le dossier `docker/` du dépôt.

## 1. Ce qu'il faut

- Une **VM Linux** (Ubuntu 24.04) avec 2 vCPU, 4 Go de RAM et 40 Go de disque pour un restaurant, et une IP publique.
- Un **nom de domaine** (par exemple `monresto.dz`) dont l'enregistrement DNS `A` pointe vers l'IP de la VM.
- Les ports **80 et 443** ouverts dans le pare-feu de l'hébergeur. Rien d'autre.
- Un compte **SMTP** pour les e-mails « mot de passe oublié » (Brevo, ou le SMTP de l'hébergeur).

## 2. Installation

```bash
# sur la VM
curl -fsSL https://get.docker.com | sh
git clone https://github.com/HaouacheOmar/RESTO.git && cd RESTO/docker   # toutes les commandes ci-dessous : depuis docker/

cp .env.prod.example .env
nano .env      # DOMAIN, SECRET_KEY, POSTGRES_PASSWORD, MONITORING_STREAM_SECRET, EMAIL_*
               # une valeur aléatoire : python3 -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser   # le gérant
```

Ouvrir `https://<domaine>` et se connecter avec ce compte gérant, qui a le rôle Gérant directement. Ensuite, dans l'espace Gérance :

1. **Tables et fournisseurs** : les tables du restaurant (numéro, places, salle ou salon VIP).
2. **Carte** : les plats, avec leurs recettes et leurs photos.
3. **Équipe** : un compte par membre du personnel (serveurs, caissier, chef…).
4. **Caméras**, si le restaurant en a : voir la section 5.

## 3. Sauvegardes

Le service `backup` écrit chaque jour dans `docker/backups/` (sur la VM) :
- `resto-<date>.dump` : la base de données ;
- `media-<date>.tgz` : les photos.

Il garde 14 jours (`KEEP_DAYS`). Ses journaux indiquent `backup … ok` ou `FAILED` :

```bash
docker compose -f docker-compose.prod.yml logs backup
```

**Copier aussi ces fichiers hors de la VM** : une sauvegarde qui reste sur le serveur disparaît avec lui. Par exemple, chaque nuit depuis une autre machine :

```bash
rsync -a user@<ip-vm>:RESTO/docker/backups/ ./resto-backups/
```

On peut aussi envoyer le dossier vers le stockage objet de l'hébergeur avec `rclone`.

### Restaurer une sauvegarde

```bash
docker compose -f docker-compose.prod.yml exec -T backup pg_restore --clean --if-exists -d resto /backups/resto-<date>.dump
docker compose -f docker-compose.prod.yml exec -T backend sh -c "tar xzf - -C /app/media" < backups/media-<date>.tgz
```

La restauration de la base a été testée : sauvegarde, suppression des comptes, restauration, et le compte gérant est revenu.

## 4. Mises à jour et suivi

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build    # les migrations passent au démarrage
docker compose -f docker-compose.prod.yml ps                           # état des services
docker compose -f docker-compose.prod.yml logs -f backend              # journaux
```

`https://<domaine>/healthz/` répond `ok` quand l'API et la base vont bien : c'est l'adresse à donner à un outil de surveillance (UptimeRobot…). Pour les erreurs, remplir `SENTRY_DSN`.

## 5. Caméras (surveillance des tables)

Le **worker** (`vision/`) ne tourne pas sur la VM, mais **dans le restaurant**, sur un PC avec carte graphique relié aux caméras. Il y en a un par caméra.

1. Le gérant ajoute la caméra dans **Gérance → Caméras** et copie le jeton, affiché une seule fois.
2. Sur le PC du restaurant, on lance le worker :

```bash
VIDEO_SOURCE=rtsp://… RESTO_API_URL=https://<domaine> RESTO_DEVICE_TOKEN=<jeton> \
MONITORING_STREAM_SECRET=<même valeur que dans .env> DEVICE=cuda:0 python -m resto_vision run
```

Les comptages arrivent tout de suite : le worker appelle l'API en HTTPS sortant, donc rien n'est à ouvrir sur la box du restaurant.

Le **flux vidéo en direct** demande en plus que la VM puisse joindre le worker. C'est prévu avec un tunnel WireGuard, pas encore inclus. Sans ce tunnel, l'écran Surveillance affiche quand même les comptages et le plan des tables.

## 6. Obligations légales (Algérie)

- **Déclaration à l'ANPDP** (loi 18-07) pour le traitement de données personnelles : comptes clients et vidéosurveillance.
- **Panneaux « établissement sous vidéosurveillance »** dans la salle, et **information du personnel**, qui est filmé lui aussi.
- Héberger la VM **en Algérie** (Icosnet, ISSAL, Algérie Télécom…) évite les questions de transfert de données à l'étranger.
- Côté application : personnes floutées à la source, aucune image enregistrée, une seule lecture par table sans historique (voir `IMPLEMENTATION.md`, section 9).
