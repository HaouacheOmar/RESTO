# RESTO — Gestion de restaurant

Système qui coordonne, en temps réel, le personnel d'un restaurant (salle, caisse, livraison, parking, stock, gérance) et ses clients, de la réservation au paiement.

## Language

### Acteurs

**Client**:
Personne titulaire d'un compte client, qui réserve une table, commande en livraison et laisse des avis.
_Avoid_: utilisateur, convive, consommateur

**Personnel**:
Ensemble des employés du restaurant, chacun ayant un seul rôle : Gérant, Responsable réservation, Chef, Serveur, Caissier, Livreur, Stationneur, Gestionnaire de stock.
_Avoid_: staff, employé (pour le rôle)

**Gérant**:
Membre du personnel qui administre le restaurant (comptes, menu, tables, fournisseurs) et reçoit les avis, transactions et alertes.
_Avoid_: admin, manager

**Chef**:
Membre du personnel dont le seul rôle dans le système est de créer le Plat du jour et de le retirer quand il est épuisé ; la préparation des Commandes en cuisine reste hors du système.
_Avoid_: cuisinier

**Candidature**:
Demande d'embauche déposée par une personne extérieure pour devenir Livreur ou Stationneur ; seul le Gérant l'accepte ou la refuse. Une personne refusée peut déposer une nouvelle Candidature.
_Avoid_: demande d'emploi, inscription

**Fournisseur**:
Entreprise qui vend au restaurant du matériel (tables, chaises, cuisinières…) ou des ingrédients.
_Avoid_: prestataire, livreur (un Livreur est un employé, jamais un Fournisseur)

### Salle

**Table**:
Emplacement numéroté de la salle, avec une capacité (nombre de personnes) et une Zone.

**Zone**:
Catégorie d'une Table : Standard ou VIP.
_Avoid_: espace, salle VIP

**Réservation**:
Demande d'un Client pour une Table à une date et heure, une Zone et un nombre de personnes, avec ou sans véhicule.
_Avoid_: booking

**Table proposée**:
Table que le système suggère pour une Réservation ; le Responsable réservation peut la remplacer, dans la même Zone, avant le check-in.
_Avoid_: table attribuée (tant qu'elle n'est pas validée)

**Check-in**:
Arrivée constatée du Client par le Responsable réservation, qui l'installe à sa Table et ouvre une Séance. Si le nombre de personnes a changé, il est corrigé et la Table remplacée (même Zone, capacité suffisante, libre) ; sinon le Check-in est impossible.

**Séance**:
Occupation d'une Table, de l'installation des personnes jusqu'au paiement de l'Addition. Elle s'ouvre au Check-in, ou à la première Commande d'un Serveur sur une Table libre (sans Réservation) ; une Table libre mais réservée sur le créneau à venir ne peut pas accueillir de Séance sans Réservation.
Une Séance sans aucune Commande peut être close sans Addition (clients partis sans commander, ouverture par erreur).
_Avoid_: occupation, service, visite, passage

**No-show**:
Réservation dont le Client ne s'est pas présenté, constatée par le Responsable réservation une fois l'heure de réservation passée. Différent d'une annulation, que seul le Client fait.
_Avoid_: absence, annulation

**Nom de Séance**:
Nom imprimé sur le ticket : celui du Client pour une Séance issue d'une Réservation, sinon un nom facultatif saisi par le Serveur (« Client sur place » par défaut).
_Avoid_: nom de réservation, nom du client

### Parking

**Prise en charge parking**:
Réponse du Stationneur à une Réservation avec véhicule : soit une place de parking gardée, soit un **parking refusé** (le lot est plein). La Réservation reste valable dans les deux cas.

### Commandes et paiement

**Commande**:
Ensemble de plats demandés en une fois, soit à une Table par un Serveur, soit en Livraison par un Client.
_Avoid_: order, ticket

**Commande annulée**:
Commande retirée en entier avant le paiement de l'Addition (par le Serveur en salle, par le Client pour une Livraison tant qu'aucun Livreur n'est désigné) ; elle ne compte pas dans l'Addition. On ne retire jamais une seule ligne : on annule et on ressaisit.

**Addition**:
Unité de paiement : toutes les Commandes d'une Séance (encaissée par le Caissier, ce qui ferme la Séance et libère la Table), ou l'unique Commande d'une Livraison (encaissée par le Livreur). Payée en une fois, par un seul moyen de paiement.
_Avoid_: facture, note, transaction

**Livraison**:
Commande apportée au domicile du Client par un Livreur, qui encaisse le montant sur place.

**Livraison échouée**:
Livraison que le Livreur n'a pas pu remettre (Client absent ou refus) : la Commande est annulée, aucune Addition n'est payée, le Gérant est prévenu. Une nouvelle tentative est une nouvelle Commande.

### Menu et stock

**Carte**:
Ensemble des plats permanents du restaurant, gérés par le Gérant.
_Avoid_: menu (pour la partie permanente seule)

**Plat du jour**:
Plat créé par le Chef pour une seule date (au plus un par date, parfois aucun), distinct des plats de la Carte. Il se commande et s'évalue comme un plat de la Carte, mais n'a pas de Recette : le Chef le retire à la main quand il est épuisé.
_Avoid_: spécialité, plat de la Carte mis en avant

**Menu**:
Ce que le Client peut commander aujourd'hui : les Plats disponibles de la Carte et le Plat du jour de la date.

**Recette**:
Liste des ingrédients qui composent un plat, sans quantités.

**Plat disponible**:
Plat que le Gérant propose au menu et dont aucun ingrédient de la Recette n'est en Rupture ; il redevient disponible de lui-même quand la Rupture prend fin.

**Rupture**:
État d'un ingrédient épuisé, signalé par le Gestionnaire de stock, qui est aussi le seul à y mettre fin. Les Commandes ne décomptent pas le stock : seul le Gestionnaire de stock le tient à jour.
_Avoid_: out of stock, manque

**Demande de réapprovisionnement**:
Demande du Gestionnaire de stock au Gérant pour racheter un ingrédient. En l'approuvant, le Gérant choisit le Fournisseur ; la marquer « reçue » ne met pas fin à la Rupture.

### Avis

**Avis**:
Note (1 à 5) et commentaire laissés par un Client sur l'une de ses Additions payées, visant le restaurant, un plat de cette Addition, ou un Serveur / Livreur qui l'a servie ; un seul Avis par cible et par Addition, dans les 7 jours suivant le paiement.
_Avoid_: feedback, rating, évaluation

## Flagged ambiguities

- ~~« Occupation de Table » sans nom~~ → résolu : **Séance**.
- « Client » désigne uniquement le titulaire d'un compte ; une Séance sans Réservation n'a pas de Client (donc pas d'Avis possible).
