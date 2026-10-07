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
      socket.onopen = () => { attempt = 0; setStatus('open') }
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

  return { status, events }
}
