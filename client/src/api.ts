import { useEffect, useState } from 'react'

/**
 * The only place that knows the API paths; components never write `/api/...` themselves.
 * Requests stay on the same origin (Vite dev proxy, reverse proxy in production).
 * The URLs remain visible in the browser's network tab: access control is the backend's job (JWT + roles).
 */
const ENDPOINTS = {
  menu: '/api/menu/',
} as const

export const api = (endpoint: keyof typeof ENDPOINTS, init?: RequestInit) =>
  fetch(ENDPOINTS[endpoint], init).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))

export interface Dish {
  id: number
  name: string
  description: string
  price: string
  photo: string | null
}

export interface DailySpecial extends Dish {
  date: string
}

export interface Menu {
  carte: Dish[]
  plat_du_jour: DailySpecial | null
}

export type MenuState =
  | { status: 'loading' }
  | { status: 'ready'; menu: Menu }
  | { status: 'error' }

/** Today's Menu (public): orderable Carte dishes + the Plat du jour. */
export function useMenu(): MenuState {
  const [state, setState] = useState<MenuState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    api('menu', { signal: controller.signal })
      .then((menu: Menu) => setState({ status: 'ready', menu }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [])
  return state
}

const dzd = new Intl.NumberFormat('fr-DZ', { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 })
export const formatPrice = (price: string) => dzd.format(Number(price))
