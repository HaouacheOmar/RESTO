import { motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

import { useApi, type Order, type Reservation, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import Deliveries from './Deliveries'
import ReservationCard from './ReservationCard'
import './desk.css'

const TAB_IDS = ['aujourdhui', 'a-valider', 'a-venir', 'livraisons', 'historique'] as const

const NOTIFICATIONS: Notifications = {
  reservation_created: (p) => `Nouvelle réservation : ${p.client_name || p.client_username}, ${p.guest_count} pers.`,
  reservation_cancelled: 'Un client a annulé sa réservation.',
  parking_refused: 'Parking complet pour une réservation : le client est prévenu.',
  order_created: (p) => `Nouvelle livraison à attribuer${p.client_name ? ` (${p.client_name})` : ''}.`,
  order_cancelled: 'Un client a annulé sa livraison.',
  delivery_failed: 'Une livraison a échoué.',
}

const sameDay = (iso: string, day: Date) => new Date(iso).toDateString() === day.toDateString()

/** Keeps "now" fresh so late reservations show up without a reload. */
function useNow(every = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

export default function DeskSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const now = useNow()
  const reservations = useApi<Reservation[]>('reservations')
  const orders = useApi<Order[]>('orders', { is_delivery: true })
  const drivers = useApi<User[]>('users', { role: 'DELIVERER' })

  const { reload: reloadReservations } = reservations
  const { reload: reloadOrders } = orders
  const { reload: reloadDrivers } = drivers
  const refresh = useCallback(() => { reloadReservations(); reloadOrders(); reloadDrivers() },
    [reloadReservations, reloadOrders, reloadDrivers])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  const all = reservations.data ?? []
  const today = new Date(now)
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()
  const lists: Record<Exclude<(typeof TAB_IDS)[number], 'livraisons'>, Reservation[]> = {
    aujourdhui: all.filter((r) => sameDay(r.reservation_time, today) && ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(r.status)),
    'a-valider': all.filter((r) => r.status === 'PENDING'),
    'a-venir': all.filter((r) => r.status === 'CONFIRMED' && new Date(r.reservation_time).getTime() >= endOfToday),
    historique: all.filter((r) => ['DONE', 'CANCELLED', 'NO_SHOW'].includes(r.status)).reverse().slice(0, 50),
  }
  const toDeliver = (orders.data ?? []).filter((o) => o.status === 'PENDING').length
  const tabs = [
    { id: 'aujourdhui' as const, label: 'Aujourd’hui', count: lists.aujourdhui.filter((r) => r.status !== 'CHECKED_IN').length },
    { id: 'a-valider' as const, label: 'À valider', count: lists['a-valider'].length },
    { id: 'a-venir' as const, label: 'À venir' },
    { id: 'livraisons' as const, label: 'Livraisons', count: toDeliver },
    { id: 'historique' as const, label: 'Historique' },
  ]

  return (
    <main className="desk">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Réservations</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={tabs} current={tab} onSelect={select} label="Réservations et livraisons">
        {tab === 'livraisons'
          ? (orders.data && drivers.data
            ? <Deliveries orders={orders.data} drivers={drivers.data} onChange={refresh} />
            : <Loading failed={orders.failed || drivers.failed} />)
          : (reservations.data
            ? (lists[tab].length === 0
              ? <p className="empty">Rien pour l’instant.</p>
              : <ul className="card-list">
                  {lists[tab].map((r) => <ReservationCard key={r.id} reservation={r} now={now} onChange={refresh} />)}
                </ul>)
            : <Loading failed={reservations.failed} />)}
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
