import { useCallback, useEffect, useState } from 'react'

/**
 * The only place that knows the API paths; components never write `/api/...` themselves.
 * Requests stay on the same origin (Vite dev proxy, nginx in Docker).
 * The URLs remain visible in the browser's network tab: access control is the backend's job (JWT + roles).
 */
const ENDPOINTS = {
  menu: '/api/menu/',
  token: '/api/auth/token/',
  refresh: '/api/auth/token/refresh/',
  logout: '/api/auth/logout/',
  register: '/api/auth/register/',
  me: '/api/auth/me/',
  reservations: '/api/reservations/',
  reservationCancel: (id: number) => `/api/reservations/${id}/cancel/`,
  reservationConfirm: (id: number) => `/api/reservations/${id}/confirm/`,
  reservationReassign: (id: number) => `/api/reservations/${id}/reassign_table/`,
  reservationCheckIn: (id: number) => `/api/reservations/${id}/check_in/`,
  reservationNoShow: (id: number) => `/api/reservations/${id}/no_show/`,
  reservationFreeTables: (id: number) => `/api/reservations/${id}/free_tables/`,
  parkingConfirm: (id: number) => `/api/reservations/${id}/confirm_parking/`,
  parkingRefuse: (id: number) => `/api/reservations/${id}/refuse_parking/`,
  orders: '/api/orders/',
  orderCancel: (id: number) => `/api/orders/${id}/cancel/`,
  orderAssign: (id: number) => `/api/orders/${id}/assign_deliverer/`,
  tables: '/api/tables/',
  seances: '/api/seances/',
  seanceClose: (id: number) => `/api/seances/${id}/close/`,
  seancePay: (id: number) => `/api/seances/${id}/pay/`,
  additionTicket: (id: number) => `/api/additions/${id}/ticket/`,
  users: '/api/users/',
  additions: '/api/additions/',
  reviews: '/api/reviews/',
  realtime: '/ws/',
} as const

type Endpoint = Exclude<keyof typeof ENDPOINTS, 'realtime'>
export type Query = Record<string, string | number | boolean>

const pathOf = (endpoint: Endpoint, id?: number, query?: Query) => {
  const path = ENDPOINTS[endpoint]
  const url = typeof path === 'function' ? path(id as number) : path
  if (!query) return url
  return `${url}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`
}

// ---------------------------------------------------------------------------------------------
// Session: the access token (5 min) lives in memory only. The refresh token (1 day) is an httpOnly
// cookie set by the backend and sent only to /api/auth/: JavaScript can never read it.
// localStorage only keeps a non-secret "a session exists" flag, so anonymous visitors don't fire a
// refresh request that is bound to fail.
// ---------------------------------------------------------------------------------------------
const HINT_KEY = 'resto.session'
let access: string | null = null
let refreshing: Promise<string | null> | null = null
const expiredListeners = new Set<() => void>()

const hint = {
  get: () => { try { return localStorage.getItem(HINT_KEY) === '1' } catch { return true } },
  set: () => { try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(HINT_KEY) } catch { /* nothing stored */ } },
}

export const session = {
  hasRefresh: hint.get,
  start(accessToken: string) {
    access = accessToken
    hint.set()
  },
  end() {
    access = null
    hint.clear()
  },
  /** Called when the refresh cookie is rejected (expired or revoked). */
  onExpired(listener: () => void) {
    expiredListeners.add(listener)
    return () => { expiredListeners.delete(listener) }
  },
}

/** Get a new access token. Concurrent callers share one request. */
export function refreshAccess(): Promise<string | null> {
  refreshing ??= (async () => {
    if (!hint.get()) return null
    const res = await fetch(ENDPOINTS.refresh, { method: 'POST' }).catch(() => null)  // cookie sent by the browser
    if (res === null) return null  // offline: keep the session, the caller fails and can retry
    if (!res.ok) {
      session.end()
      expiredListeners.forEach((l) => l())
      return null
    }
    access = (await res.json()).access as string
    return access
  })().finally(() => { refreshing = null })
  return refreshing
}

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(status: number, data: unknown) {
    super(`API ${status}`)
    this.status = status
    this.data = data
  }
}

export type Errors = Record<string, string>

/** DRF errors ({field: [messages]} or {detail}) → one message per field, `form` for the rest. */
export function toErrors(error: unknown, fallback: string): Errors {
  if (!(error instanceof ApiError) || typeof error.data !== 'object' || error.data === null) {
    return { form: 'Connexion au serveur impossible. Réessayez dans un instant.' }
  }
  const errors: Errors = {}
  for (const [field, value] of Object.entries(error.data as Record<string, unknown>)) {
    const message = Array.isArray(value) ? value.join(' ') : String(value)
    errors[field === 'detail' || field === 'non_field_errors' ? 'form' : field] = message
  }
  return Object.keys(errors).length ? errors : { form: fallback }
}

interface RequestOptions {
  /** For endpoints about one object, e.g. `api('orderCancel', { id: 4, method: 'POST' })`. */
  id?: number
  query?: Query
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  auth?: boolean
}

/** Call the API. With `auth` (default), attaches the access token and refreshes it once on 401. */
export async function api<T>(endpoint: Endpoint, { id, query, method = 'GET', body, signal, auth = true }: RequestOptions = {}): Promise<T> {
  const send = (token: string | null) => fetch(pathOf(endpoint, id, query), {
    method,
    signal,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (auth && !access && session.hasRefresh()) await refreshAccess()
  let res = await send(auth ? access : null)
  if (res.status === 401 && auth && (await refreshAccess())) res = await send(access)
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

/** Load an authenticated list/object; `reload()` refetches (e.g. after a live event). */
export function useApi<T>(endpoint: Endpoint, query?: Query) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const queryKey = query ? JSON.stringify(query) : ''
  const reload = useCallback(() => api<T>(endpoint, { query: queryKey ? JSON.parse(queryKey) : undefined })
    .then((value) => { setData(value); setFailed(false) })
    .catch(() => setFailed(true)), [endpoint, queryKey])
  useEffect(() => { reload() }, [reload])
  return { data, failed, reload }
}

/** WebSocket URL with a freshly refreshed token, or null when logged out. */
export async function realtimeUrl(): Promise<string | null> {
  const token = await refreshAccess()
  if (!token) return null
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${ENDPOINTS.realtime}?token=${encodeURIComponent(token)}`
}

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------
export type Role =
  | 'ADMIN_MANAGER' | 'RESERVATION_MANAGER' | 'CHEF' | 'SERVER' | 'CASHIER'
  | 'DELIVERER' | 'PARKING_ATTENDANT' | 'STOCK_MANAGER' | 'CLIENT'

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  role: Role
  phone: string
  availability?: 'AVAILABLE' | 'BUSY' | 'OFFLINE'
}

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'DONE' | 'CANCELLED' | 'NO_SHOW'
export type Zone = 'STANDARD' | 'VIP'

export interface Reservation {
  id: number
  reservation_time: string
  guest_count: number
  zone: Zone
  has_vehicle: boolean
  parking_status: '' | 'REQUESTED' | 'SECURED' | 'REFUSED'
  parking_spot: string
  table_number: number | null
  status: ReservationStatus
  client_name: string
  client_username: string
  client_phone: string
}

export interface Table {
  id: number
  number: number
  capacity: number
  zone: Zone
  is_occupied: boolean
  /** A reservation not yet seated holds the table now: no walk-in possible. */
  reserved_at: string | null
}

export interface Seance {
  id: number
  table_number: number
  name: string
  status: 'OPEN' | 'PAID' | 'CLOSED'
  reservation: number | null
  orders: Order[]
  total_due: string
  opened_at: string
}

/** Receipt content, as printed by the cashier. Amounts may come back as numbers. */
export interface Ticket {
  addition: number
  name: string | null
  date: string
  table_number: number | null
  items: { name: string; quantity: number; unit_price: string | number; subtotal: string | number }[]
  total: string | number
  method: 'CASH' | 'CARD'
}

export interface FreeTable {
  number: number
  capacity: number
  zone: Zone
}

export type OrderStatus = 'PENDING' | 'PAID' | 'DELIVERING' | 'DELIVERED' | 'CANCELLED' | 'FAILED'

export interface OrderLine {
  dish: number | null
  daily_special: number | null
  name: string
  quantity: number
  unit_price: string
}

export interface Order {
  id: number
  items: OrderLine[]
  is_delivery: boolean
  delivery_address: string
  status: OrderStatus
  total: string
  deliverer_name: string | null
  client_name: string | null
  client_phone: string | null
  created_at: string
}

export interface ReviewTarget {
  dish: number | null
  daily_special: number | null
  staff: number | null
}

export interface Addition {
  id: number
  amount: string
  method: 'CASH' | 'CARD'
  created_at: string
  table_number: number | null
  items: { dish: number | null; daily_special: number | null; name: string }[]
  staff: { id: number; name: string; role: Role }[]
  reviews: (ReviewTarget & { rating: number })[]
  reviewable_until: string
}

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
    api<Menu>('menu', { signal: controller.signal, auth: false })
      .then((menu) => setState({ status: 'ready', menu }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [])
  return state
}

const dzd = new Intl.NumberFormat('fr-DZ', { style: 'currency', currency: 'DZD', maximumFractionDigits: 0 })
export const formatPrice = (price: string) => dzd.format(Number(price))

const dateTime = new Intl.DateTimeFormat('fr-DZ', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateOnly = new Intl.DateTimeFormat('fr-DZ', { day: 'numeric', month: 'long', year: 'numeric' })
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
export const formatDate = (iso: string) => dateOnly.format(new Date(iso))
