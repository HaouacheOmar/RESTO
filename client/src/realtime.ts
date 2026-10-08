import { useEffect, useState } from 'react'

import { realtimeUrl } from './api'

export interface LiveEvent {
  id: number
  event: string
  payload: Record<string, unknown>
  receivedAt: Date
}

export type LiveStatus = 'connecting' | 'open' | 'offline'

const MAX_EVENTS = 50

/**
 * One WebSocket per logged-in user. Each (re)connection uses a freshly refreshed access token,
 * so an expired token never blocks reconnection. Backs off up to 30s between attempts.
 */
export function useRealtime(enabled: boolean) {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connections, setConnections] = useState(0)  // successful opens; > 1 means we reconnected

  useEffect(() => {
    if (!enabled) return
    let socket: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let nextId = 0

    const retry = () => {
      if (stopped) return
      setStatus('connecting')
      timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempt++))
    }

    async function connect() {
      const url = await realtimeUrl()
      if (stopped) return
      if (!url) return setStatus('offline')
      socket = new WebSocket(url)
      socket.onopen = () => { attempt = 0; setStatus('open'); setConnections((n) => n + 1) }
      socket.onmessage = (message) => {
        const { event, payload } = JSON.parse(message.data)
        setEvents((list) => [{ id: nextId++, event, payload, receivedAt: new Date() }, ...list].slice(0, MAX_EVENTS))
      }
      socket.onclose = retry
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [enabled])

  return { status, events, connections }
}

export type Notifications = Record<string, string | ((payload: Record<string, unknown>) => string)>

/**
 * For a role space: every live event calls `refresh` (keep it stable with useCallback) and, when the
 * event has a message in `notifications`, exposes it as a toast for 6 seconds. After a reconnection
 * it refreshes too, since events sent while disconnected are lost.
 */
export function useLiveRefresh(refresh: () => void, notifications: Notifications) {
  const { status, events, connections } = useRealtime(true)
  const latest = events[0]
  const [dismissed, setDismissed] = useState(-1)

  useEffect(() => {
    if (connections > 1) refresh()  // the first connection: the page has just loaded its data
  }, [connections, refresh])

  useEffect(() => {
    if (!latest) return
    refresh()
    const timer = setTimeout(() => setDismissed(latest.id), 6000)
    return () => clearTimeout(timer)
  }, [latest, refresh])

  const message = latest && latest.id !== dismissed ? notifications[latest.event] : undefined
  const text = typeof message === 'function' ? message(latest!.payload) : message
  return { status, toast: text ? { id: latest!.id, text } : null }
}
