# Démo client depuis la maison

La version complète (modèle de vision sur la carte graphique, flou, comptage des tables) tourne sur le **PC fixe à la maison**. Un **tunnel Cloudflare** temporaire lui donne une adresse HTTPS. Chez le client, le **portable n'ouvre qu'un navigateur**.

```
MAISON : PC fixe (RTX 4060)                       CHEZ LE CLIENT
 RESTO + worker GPU ──tunnel Cloudflare──▶  portable : https://xxxx.trycloudflare.com
```

## La veille

1. **Mesure le débit montant** de la box, sur speedtest.net, depuis le PC fixe (chiffre « Upload »). Le flux vidéo de démo demande environ **2 Mbit/s** (mesuré : 1,9 Mbit/s, avec `TARGET_FPS=6` et `JPEG_QUALITY=45` dans `docker/docker-compose.demo.yml`). Le reste du site ne consomme presque rien.
2. **Copie la vidéo de secours** sur le portable : `RESTO-demo-secours.mp4` (1 min 39). Elle est sur le Bureau, et OneDrive la synchronise.
3. **Charge le portable** et active le **partage de connexion 4G** du téléphone, au cas où le Wi-Fi du client ne marche pas.

## Le jour J, avant de partir

Sur le PC fixe, depuis la racine du dépôt :

```bash
# 1. toute la pile + le worker GPU + le tunnel
docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml -f docker/docker-compose.demo.yml --profile vision up -d --build

# 2. l'adresse publique (elle change à chaque démarrage du tunnel)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.demo.yml logs tunnel | grep trycloudflare.com
```

- **Ouvre l'adresse depuis ton téléphone en 4G** (pas en Wi-Fi), puis connecte-toi en `manager` et ouvre *Surveillance*. Si la vidéo en direct s'affiche, tout est bon.
- **Désactive la mise en veille** du PC fixe : *Paramètres → Système → Alimentation → Écran et veille → Jamais*.
- **Ne ferme pas Docker Desktop.**

## Pendant la démo (10 minutes)

Comptes de démonstration, avec le mot de passe `demo-resto-2026` :

| Étape | Compte | Ce que tu montres |
| :--- | :--- | :--- |
| 1 | `client` (ou une inscription) | réserver une table : zone, nombre de personnes, parking |
| 2 | `reservations` | la demande arrive en direct ; confirmer, puis check-in et installation |
| 3 | `waiter` | le plan de salle, la commande envoyée en caisse |
| 4 | `cashier` | l'encaissement et le ticket 80 mm |
| 5 | `manager` → *Surveillance* | la caméra en direct : personnes floutées, coins, tables colorées, « 2/4 » |
| 6 | `manager` → *Caméras* | ajouter une caméra, dessiner une table : c'est la base d'un essai avec **ses** caméras |
| 7 | `manager` → *Tableau de bord* | chiffre d'affaires, plats les plus vendus, avis |

**Astuce** : ouvre deux onglets, par exemple *Réservations* et *Client*, pour montrer la mise à jour en temps réel sans recharger.

## Si quelque chose lâche

- **La vidéo en direct rame** : la démo continue, c'est la connexion de la maison qui limite le débit. Montre la surveillance avec la vidéo de secours, et le reste en direct.
- **Plus de connexion du tout** (coupure à la maison ou chez le client) : passe sur la **vidéo de secours**, qui tourne sans Internet.

## Juste après la démo

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.demo.yml stop tunnel
```

**Pendant que le tunnel tourne, les comptes de démonstration (mot de passe public) sont accessibles depuis Internet.** Ferme-le dès la fin.

## Si le client dit oui

C'est l'étape suivante : un essai avec **ses** caméras. Pour une première fois, on branche le worker sur l'adresse RTSP d'une de ses caméras (`VIDEO_SOURCE=rtsp://…`), et on dessine ses tables dans l'onglet *Caméras*. Pour la production, voir [HEBERGEMENT.md](HEBERGEMENT.md) et [DEPLOIEMENT.md](DEPLOIEMENT.md).
