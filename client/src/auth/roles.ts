import type { Role, User } from '../api'

export interface Space {
  slug: string
  title: string
}

/** Each role has exactly one space, at /espace/<slug>. */
export const SPACES: Record<Role, Space> = {
  CLIENT: { slug: 'client', title: 'Mon espace' },
  RESERVATION_MANAGER: { slug: 'reservations', title: 'Réservations' },
  PARKING_ATTENDANT: { slug: 'parking', title: 'Parking' },
  SERVER: { slug: 'salle', title: 'Salle' },
  CASHIER: { slug: 'caisse', title: 'Caisse' },
  DELIVERER: { slug: 'livraison', title: 'Livraisons' },
  CHEF: { slug: 'chef', title: 'Cuisine' },
  STOCK_MANAGER: { slug: 'stock', title: 'Stock' },
  ADMIN_MANAGER: { slug: 'gerant', title: 'Gérance' },
}

export const homeOf = (user: User) => `/espace/${SPACES[user.role].slug}`

export const roleOfSlug = (slug: string | undefined) =>
  (Object.keys(SPACES) as Role[]).find((role) => SPACES[role].slug === slug)

/** A role sees its own space; the manager may open any space. */
export const canOpen = (user: User, role: Role) => user.role === role || user.role === 'ADMIN_MANAGER'
