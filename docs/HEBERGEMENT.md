# Hébergement de RESTO chez Icosnet

Ce document décrit ce qu'il faut louer chez Icosnet (datacenter en Algérie), et comment le tout se branche, pour héberger RESTO pour un restaurant, **surveillance des tables par caméra comprise**. Il sert de base pour demander un devis. L'installation pas à pas se trouve dans [DEPLOIEMENT.md](DEPLOIEMENT.md).

La démo en ligne (Vercel + Render) ne sert qu'au portfolio : le modèle de vision n'y tourne pas.

## 1. En bref : ce qu'on demande

| Élément | Pour quoi faire | Quantité |
| :--- | :--- | :--- |
| **Serveur avec GPU NVIDIA** (VM GPU ou serveur dédié), Ubuntu 24.04 | L'application RESTO et le modèle de vision (YOLO26 pose + DeepSORT), un worker par caméra | 1 (phase 1) |
| **IPv4 publique** + ports 80/443 ouverts | Le site en HTTPS | 1 |
| **VPN site-à-site** entre le restaurant et le datacenter (IP-VPN/MPLS, ou un routeur WireGuard dans le restaurant) | Faire arriver les flux des caméras au serveur sans les exposer sur Internet | 1 par restaurant |
| **Stockage pour les sauvegardes**, hors du serveur (stockage objet ou deuxième serveur) | Une copie quotidienne de la base et des photos | quelques Go |
| Nom de domaine (`.dz` ou autre) | L'adresse du site | 1 |

## 2. Architecture

```
            RESTAURANT                                  DATACENTER ICOSNET (Algérie)
 ┌──────────────────────────────┐            ┌──────────────────────────────────────────────┐
 │ caméras IP (RTSP, réseau local)│──VPN──────▶│ serveur GPU                                  │
 │                                │ site-à-site│   vision-<caméra> : YOLO26 + DeepSORT, flou  │
 │ tablettes / PC du personnel    │            │        │ nombres            │ vidéo floutée  │
 │ (navigateur)                   │◀──HTTPS───▶│   Caddy (TLS) ─ nginx ─ Django ─ PostgreSQL  │
 └──────────────────────────────┘            │                          └─ Redis             │
        clients (réservations) ◀──HTTPS───▶   │   backup (quotidien) ──▶ stockage hors serveur │
                                              └──────────────────────────────────────────────┘
```

- **Les caméras ne sont jamais visibles sur Internet** : leur vidéo arrive au datacenter uniquement par le VPN.
- **Le worker floute tout le monde** avant que l'image n'aille plus loin : aucune image n'est enregistrée, et seuls des nombres (personnes par table) entrent dans la base.
- **Le navigateur ne voit que le flux flouté**, servi par nginx sous `https://<domaine>/stream/<caméra>/`, avec un ticket signé valable 60 s.

## 3. Dimensionnement

**Mesuré** sur une RTX 4060 (carte grand public), pour une caméra en 720p :

| Mesure | Valeur |
| :--- | :--- |
| Calcul par image (détection + flou) | 30 ms |
| Images par seconde affichées | 23 au maximum (vitesse normale) ; environ 12 à 15 sur la démo, ralentie de moitié |
| Mémoire GPU par worker | 1,6 Go |
| Charge GPU pour une caméra (12 à 15 images/s) | 17 % |
| Flux flouté envoyé au navigateur (MJPEG 720p) | 5 Mbit/s par écran ouvert (environ 10 Mbit/s à 25 images/s) |

**Estimé**, à confirmer par un test de charge sur le GPU proposé :
- **Phase 1**, un restaurant avec 2 à 4 caméras : **un seul serveur** avec un GPU de datacenter (NVIDIA **L4** ou **T4**, 16 à 24 Go), 8 vCPU, 32 Go de RAM et 200 Go de SSD. Il fait tourner l'application et les workers ensemble. Avec 1,6 Go par worker, la mémoire GPU n'est pas la limite : c'est le calcul. Régler les workers à 10–12 images/s (`TARGET_FPS`) laisse de la marge, car le comptage n'a besoin que de 5 analyses par seconde.
- **Phase 2**, plusieurs restaurants ou beaucoup de caméras : séparer en **une VM sans GPU pour l'application** (2 vCPU, 4 Go de RAM, 40 Go) et **un ou plusieurs serveurs GPU pour les workers**.

## 4. Réseau

| De | Vers | Port / protocole | Contenu |
| :--- | :--- | :--- | :--- |
| Caméras (restaurant) | worker (datacenter) | RTSP 554, **dans le VPN** | vidéo brute ; utiliser le **sous-flux 720p** de la caméra, car le modèle travaille en 640 px |
| Navigateurs (personnel, clients) | Caddy | HTTPS 443 (80 redirige vers 443) | le site, l'API, le WebSocket temps réel, le flux flouté |
| Worker | API (même serveur) | HTTP interne | configuration (zones), comptages |
| Serveur | Let's Encrypt | HTTPS sortant | le certificat (renouvelé automatiquement) |
| Serveur | serveur SMTP | 587 sortant | les e-mails « mot de passe oublié » |

**Débit nécessaire** :
- **En montée, au restaurant** : environ **1 à 2 Mbit/s par caméra** en 720p H.264, en continu. Par exemple, 4 caméras demandent 4 à 8 Mbit/s de montée garantis, plus une marge.
- **En descente, au restaurant** : environ **5 Mbit/s par écran** qui regarde la surveillance. Seuls le gérant et le responsable des réservations y ont accès.

## 5. Sécurité

- Seuls les ports **80 et 443** sont ouverts sur Internet. La base, Redis et les workers restent sur le réseau interne Docker.
- Les caméras ne sont joignables que par le VPN.
- **Les secrets sont obligatoires** : le serveur refuse de démarrer sans eux (`.env`). Chaque caméra a son propre jeton, et le serveur n'en garde que l'empreinte SHA-256.
- Le serveur doit être un **utilisateur non root** avec une connexion SSH par clé. Les mises à jour de sécurité du système sont à activer (`unattended-upgrades`).
- La production ne contient **aucun compte de démonstration** (`SEED_DEMO=0`).

## 6. Données et obligations (loi 18-07)

- Tout est hébergé **en Algérie** : la base, les sauvegardes et le traitement vidéo.
- Il faut faire une **déclaration auprès de l'ANPDP**, poser des **panneaux « vidéosurveillance »** dans la salle, et **informer le personnel**.
- Aucune vidéo n'est enregistrée et aucun visage n'est reconnu. Pour chaque table, seule la dernière lecture est gardée, sans historique.
- Les sauvegardes partent chaque jour, et doivent être copiées **hors du serveur** (voir [DEPLOIEMENT.md](DEPLOIEMENT.md), section 3).

## 7. Ce qui reste à faire dans le code

Avant l'installation chez Icosnet, il reste trois choses à faire dans le code :
1. **Ajouter les workers à `docker-compose.prod.yml`** : un service `vision-<caméra>` par caméra, avec le GPU (comme `docker-compose.gpu.yml`), `VIDEO_SOURCE=rtsp://…` (l'adresse de la caméra dans le VPN) et son jeton.
2. **En phase 2 seulement** (workers sur un autre serveur que l'application) : faire pointer nginx `/stream/<caméra>/` vers l'adresse interne de ce serveur, au lieu du nom Docker.
3. **Un test de charge** sur le GPU proposé par Icosnet, avec le nombre réel de caméras, pour fixer `TARGET_FPS`.

## 8. Questions à poser à Icosnet

- **Le GPU**
  - Quels GPU sont disponibles (L4, T4, A10, A100…) ?
  - En VM ou en serveur dédié ?
  - Avec quel pilote NVIDIA, et Docker y est-il supporté (NVIDIA Container Toolkit) ?
- **Les conditions**
  - Facturation mensuelle ou à l'heure ?
  - Est-il possible de **tester un GPU quelques jours** avant de s'engager ?
- **Le VPN**
  - Quelle offre de VPN site-à-site pour relier un restaurant au datacenter (IP-VPN/MPLS, ou un routeur fourni) ?
  - Quel débit montant est garanti sur la ligne du restaurant ?
- **Le réseau**
  - Une IPv4 publique fixe est-elle incluse ?
  - Le trafic sortant est-il limité ou facturé (le flux flouté vers les écrans) ?
- **Les sauvegardes**
  - Y a-t-il un stockage objet ou un espace de sauvegarde séparé ?
  - Proposent-ils des snapshots du serveur ?
- **L'hébergement**
  - Dans quel datacenter, et dans quelle ville ?
  - Quel engagement de disponibilité (SLA) ?
  - Quel support, et à quels horaires ?
- Peuvent-ils fournir des **documents utiles pour la déclaration ANPDP** (localisation des données, sous-traitance) ?
