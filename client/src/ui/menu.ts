import type { Menu } from '../api'

/** One orderable line of today's Menu: a Carte dish or the Plat du jour. */
export interface Product {
  key: string
  dish?: number
  daily_special?: number
  name: string
  price: string
  note?: string
}

/** Quantity per product key. */
export type Cart = Record<string, number>

export const productsOf = (menu: Menu): Product[] => [
  ...(menu.plat_du_jour ? [{
    key: `s${menu.plat_du_jour.id}`, daily_special: menu.plat_du_jour.id, name: menu.plat_du_jour.name,
    price: menu.plat_du_jour.price, note: 'Plat du jour',
  }] : []),
  ...menu.carte.map((d) => ({ key: `d${d.id}`, dish: d.id, name: d.name, price: d.price })),
]

export const cartLines = (products: Product[], cart: Cart) => products.filter((p) => cart[p.key])

export const cartTotal = (products: Product[], cart: Cart) =>
  cartLines(products, cart).reduce((sum, p) => sum + Number(p.price) * cart[p.key], 0)

/** Order lines in the API's shape. */
export const orderItems = (products: Product[], cart: Cart) =>
  cartLines(products, cart).map((p) => ({ dish: p.dish, daily_special: p.daily_special, quantity: cart[p.key] }))

export const bump = (cart: Cart, key: string, delta: number): Cart =>
  ({ ...cart, [key]: Math.max(0, Math.min(20, (cart[key] ?? 0) + delta)) })
