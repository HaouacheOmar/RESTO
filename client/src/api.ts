import { useEffect, useState } from 'react'

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
  realtime: '/ws/',
} as const

type Endpoint = Exclude<keyof typeof ENDPOINTS, 'realtime'>

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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  auth?: boolean
}

/** Call the API. With `auth` (default), attaches the access token and refreshes it once on 401. */
export async function api<T>(endpoint: Endpoint, { method = 'GET', body, signal, auth = true }: RequestOptions = {}): Promise<T> {
  const send = (token: string | null) => fetch(ENDPOINTS[endpoint], {
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
