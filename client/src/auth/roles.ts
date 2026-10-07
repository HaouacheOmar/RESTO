import type { Role, User } from '../api'

export interface Space {
  slug: string
  title: string
  /** What this space will let the role do (built in the following tickets). */
  upcoming: string[]
}

/** Each role has exactly one space, at /espace/<slug>. */
export const SPACES: Record<Role, Space> = {
  CLIENT: {
    slug: 'client', title: 'Mon espace',
    upcoming: ['Réserver une table en salle ou au salon VIP', 'Commander en livraison', 'Suivre mes réservations et commandes', 'Donner mon avis'],
  },
  RESERVATION_MANAGER: {
    slug: 'reservations', title: 'Réservations',
    upcoming: ['Valider les réservations', 'Changer la table proposée', 'Check-in et no-show', 'Attribuer les livraisons'],
  },
  PARKING_ATTENDANT: {
    slug: 'parking', title: 'Parking',
    upcoming: ['Recevoir les demandes de stationnement', 'Garder ou refuser une place'],
  },
  SERVER: {
    slug: 'salle', title: 'Salle',
    upcoming: ['Plan de salle en direct', 'Prendre une commande à table', 'Installer un client sans réservation'],
  },
  CASHIER: {
    slug: 'caisse', title: 'Caisse',
    upcoming: ['Séances ouvertes et montants dus', 'Encaisser l’Addition', 'Imprimer le ticket'],
  },
  DELIVERER: {
    slug: 'livraison', title: 'Livraisons',
    upcoming: ['Mes livraisons attribuées', 'Confirmer la livraison et l’encaissement', 'Déclarer une livraison échouée'],
  },
  CHEF: {
    slug: 'chef', title: 'Cuisine',
    upcoming: ['Créer le Plat du jour', 'Le retirer quand il est épuisé'],
  },
  STOCK_MANAGER: {
    slug: 'stock', title: 'Stock',
    upcoming: ['Suivre les ingrédients', 'Déclarer et lever une Rupture', 'Demander un réapprovisionnement'],
  },
  ADMIN_MANAGER: {
    slug: 'gerant', title: 'Gérance',
    upcoming: ['Tableau de bord', 'Personnel et candidatures', 'Carte, tables et fournisseurs', 'Additions et avis'],
  },
}

export const homeOf = (user: User) => `/espace/${SPACES[user.role].slug}`

export const roleOfSlug = (slug: string | undefined) =>
  (Object.keys(SPACES) as Role[]).find((role) => SPACES[role].slug === slug)

/** A role sees its own space; the manager may open any space. */
export const canOpen = (user: User, role: Role) => user.role === role || user.role === 'ADMIN_MANAGER'
