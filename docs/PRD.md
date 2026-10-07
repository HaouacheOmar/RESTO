# Product Requirements Document (PRD) — RESTO, système distribué de gestion de restaurant

> Le vocabulaire (Séance, Addition, Carte, Plat du jour, Rupture…) est défini dans [`CONTEXT.md`](../CONTEXT.md).

## 1. Vue d'ensemble
RESTO est une application distribuée de gestion de restaurant. Un serveur central (API REST + WebSockets) synchronise en temps réel plusieurs espaces : gérant, réservation, chef, salle (serveurs), caisse, livraison, parking, stock et clients.

**Objectifs**
- Couvrir le parcours complet d'un client : réservation (Standard ou VIP) ou livraison à domicile, commande, paiement, avis.
- Accueillir aussi les clients sans réservation.
- Donner au gérant une vision globale : personnel, fournisseurs, Carte, tables, Additions, avis, statistiques.
- Notifier chaque acteur en temps réel des événements qui le concernent.

---

## 2. Acteurs et rôles

| Rôle | Code | Création du compte | Responsabilités |
| :--- | :--- | :--- | :--- |
| Gérant | `ADMIN_MANAGER` | Superutilisateur initial | Crée les comptes du personnel (et le sien), valide les Candidatures, gère Fournisseurs, tables et Carte (plats et Recettes), approuve les Demandes de réapprovisionnement, consulte Additions, avis et dashboard. Accès à tout. |
| Responsable réservation | `RESERVATION_MANAGER` | Par le gérant | Valide les réservations, change la table proposée, fait le check-in, constate les No-shows, attribue les livraisons. |
| Chef | `CHEF` | Par le gérant | Crée chaque jour le Plat du jour et le retire quand il est épuisé. La préparation en cuisine reste hors du système. |
| Serveur | `SERVER` | Par le gérant | Prend les Commandes à table, installe les clients sans réservation, annule une Commande non payée, clôt une Séance vide. |
| Caissier | `CASHIER` | Par le gérant | Encaisse l'Addition d'une Séance, imprime le ticket. |
| Livreur | `DELIVERER` | Candidature acceptée (ou créé par le gérant) | Livre, encaisse chez le client, confirme la livraison ou la déclare échouée. |
| Stationneur | `PARKING_ATTENDANT` | Candidature acceptée (ou créé par le gérant) | Garde une place de parking ou refuse la demande si le parking est plein. |
| Gestionnaire de stock | `STOCK_MANAGER` | Par le gérant | Tient le stock, déclare et lève les Ruptures, crée les Demandes de réapprovisionnement. |
| Client | `CLIENT` | Inscription libre (email, nom d'utilisateur, mot de passe) | Réserve, commande en livraison, annule, laisse des avis. |

Un compte du personnel est identifié par **nom d'utilisateur + mot de passe**.

---

## 3. Cas d'utilisation

### UC-01 — Comptes et recrutement
1. Le gérant crée les comptes employés : nom d'utilisateur, mot de passe, rôle.
2. Un candidat **livreur** ou **stationneur** dépose une Candidature publique : nom complet, téléphone, rôle souhaité, identifiants souhaités.
3. Le gérant l'**accepte** (le compte est créé et peut se connecter tout de suite) ou la **refuse**. Une personne refusée peut déposer une nouvelle Candidature. Un nom d'utilisateur n'est réservé qu'une fois le compte créé.

### UC-02 — Administration
1. **Fournisseurs** de matériel (tables, chaises, cuisinières…) et d'ingrédients.
2. **Tables** : numéro unique, capacité, Zone `STANDARD` ou `VIP`.
3. **Carte** : plats permanents (nom, description, photo, prix) avec leur **Recette** (liste d'ingrédients, sans quantités). Un plat est **disponible** si le gérant le propose **et** si aucun ingrédient de sa Recette n'est en Rupture.
4. **Plat du jour** (Chef) : un plat créé pour une seule date (au plus un par date, parfois aucun), distinct de la Carte, sans Recette. Le Chef le retire à la main quand il est épuisé.
5. **Menu** (public) : ce qui peut se commander aujourd'hui, c'est-à-dire les plats disponibles de la Carte et le Plat du jour de la date.

### UC-03 — Réservation de table
1. Le client indique la date/heure, le nombre de personnes, la Zone et s'il vient en véhicule.
2. Le système **propose** la plus petite table libre de la Zone qui convient. Une réservation occupe sa table pendant un créneau de 2 h. Sans table libre, la réservation est refusée.
3. **Parking** (si véhicule) : le stationneur reçoit la demande en temps réel. Soit il garde une place (une même place ne peut pas servir deux fois sur des créneaux qui se chevauchent), soit il **refuse** (parking plein) ; dans les deux cas la réservation reste valable.
4. Le responsable **valide**. Avant le check-in, il peut **remplacer la table proposée** par une autre de la **même Zone**.
5. Le client peut **annuler** tant qu'il n'a pas fait son check-in. Une fois l'heure passée, le responsable peut constater un **No-show**.

### UC-04 — Séance et service en salle
1. **Check-in** : le responsable installe le client et ouvre une **Séance**. Si le nombre de personnes a changé, il le corrige et change de table (même Zone, capacité suffisante, libre) ; sans table qui convient, le check-in est impossible.
2. **Sans réservation** : le serveur prend une Commande sur une table libre, ce qui ouvre la Séance, avec un nom facultatif (« Client sur place » par défaut). C'est refusé si la table est réservée sur le créneau à venir.
3. **Commandes** : le serveur saisit autant de Commandes que nécessaire (plats de la Carte et/ou Plat du jour). Il peut **annuler une Commande entière** tant que l'Addition n'est pas payée ; on ne retire jamais une seule ligne.
4. **Addition** : le caissier encaisse **toutes** les Commandes de la Séance en un seul paiement (espèces ou carte). La Séance est close, la table libérée et la réservation terminée, le tout de manière atomique.
5. **Ticket** : nom de Séance, date/heure, numéro de table, lignes (plat, quantité, prix), total, moyen de paiement.
6. **Séance vide** : si personne n'a commandé, le serveur ou le responsable la clôt sans Addition.

### UC-05 — Livraison à domicile
1. Le client commande avec son adresse. La commande est `PENDING` et les responsables et livreurs sont notifiés.
2. Le client peut **annuler** tant qu'aucun livreur n'est désigné.
3. Le responsable choisit un livreur `AVAILABLE`, qui passe `BUSY`.
4. Le livreur remet la commande et encaisse ; c'est l'**Addition** de la livraison. La commande passe `DELIVERED` et le livreur redevient disponible.
5. Si le client est absent ou refuse, c'est une **Livraison échouée** : pas d'Addition, le livreur est libéré et le gérant prévenu. Une nouvelle tentative se fait par une nouvelle commande.

### UC-06 — Stock
1. Le gestionnaire de stock tient les ingrédients à jour et déclare une **Rupture**. Les plats de la Carte qui contiennent l'ingrédient deviennent indisponibles.
2. Il crée une **Demande de réapprovisionnement** et le gérant est notifié.
3. Le gérant l'**approuve en choisissant un Fournisseur d'ingrédients**, puis la marque **reçue**.
4. Seul le gestionnaire de stock **lève la Rupture** (la marchandise reçue ne suffit pas). Les plats redeviennent alors disponibles d'eux-mêmes.

### UC-07 — Avis et dashboard
1. Un client laisse un **Avis** (note de 1 à 5 + commentaire) sur une de **ses Additions payées**, dans les **7 jours**. L'avis vise **une** cible : le restaurant, un plat ou le Plat du jour de cette Addition, ou un serveur / livreur qui l'a servie. Un seul avis par cible et par Addition.
2. Chaque avis remonte en temps réel au gérant.
3. **Dashboard** : chiffre d'affaires (total et par jour), commandes par statut, articles les plus vendus, notes (restaurant, personnel, plats, Plats du jour), No-shows, livraisons échouées, Ruptures, demandes de stock en attente.

---

## 4. Statuts

| Objet | Statuts |
| :--- | :--- |
| Réservation | `PENDING` → `CONFIRMED` → `CHECKED_IN` → `DONE` ; `CANCELLED` (client) ; `NO_SHOW` |
| Parking d'une réservation | `REQUESTED` → `SECURED` ou `REFUSED` |
| Séance | `OPEN` → `PAID` (Addition encaissée) ou `CLOSED` (vide) |
| Commande sur place | `PENDING` → `PAID` ; `CANCELLED` |
| Commande livrée | `PENDING` → `DELIVERING` → `DELIVERED` ou `FAILED` ; `CANCELLED` (avant attribution) |
| Livreur | `AVAILABLE` ⇄ `BUSY` (`OFFLINE` réglable par le gérant) |
| Candidature | `PENDING` → `ACCEPTED` / `REJECTED` |
| Demande de réapprovisionnement | `PENDING` → `APPROVED` (fournisseur choisi) → `FULFILLED` |

---

## 5. Exigences non fonctionnelles
- **Temps réel** : chaque acteur reçoit les événements de son rôle par WebSocket.
- **Cohérence** : encaissement, attribution de livreur, ouverture de Séance et attribution de table sont transactionnels et verrouillés, et la base garantit au plus une Séance ouverte par table.
- **Sécurité** : JWT, mots de passe hachés, contrôle d'accès par rôle sur chaque endpoint.

## 6. Hors périmètre
Frontend (prévu dans `client/`), paiement en ligne, Addition partagée (paiement en plusieurs fois), flux de préparation en cuisine, quantités dans les Recettes et décompte automatique du stock, géolocalisation des livreurs, plan de parking prédéfini, durée de réservation variable.
