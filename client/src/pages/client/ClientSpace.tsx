import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'

import { useApi, type Addition, type Order, type Reservation, type User } from '../../api'
import { rise } from '../../motion'
import { useRealtime } from '../../realtime'
import { BookingForm, ReservationList } from './Booking'
import { DeliveryOrder, OrderList } from './Delivery'
import { AdditionReviews } from './Reviews'
import './client.css'

const TABS = [
  { id: 'reserver', label: 'Réserver' },
  { id: 'commander', label: 'Commander' },
  { id: 'reservations', label: 'Mes réservations' },
  { id: 'commandes', label: 'Mes commandes' },
  { id: 'avis', label: 'Mes avis' },
] as const
type TabId = (typeof TABS)[number]['id']

/** What a live event means for the client, in their words. */
const NOTIFICATIONS: Record<string, string> = {
  reservation_confirmed: 'Votre réservation est confirmée.',
  parking_confirmed: 'Une place de parking vous est gardée.',
  parking_refused: 'Le parking est complet ce jour-là : prévoyez de stationner à proximité.',
  table_reassigned: 'Votre table a changé.',
  checked_in: 'Bienvenue ! Vous êtes installés.',
  reservation_no_show: 'Votre réservation a été marquée comme non honorée.',
  order_on_the_way: 'Votre commande est en route.',
  order_delivered: 'Votre commande est livrée. Bon appétit !',
  delivery_failed: 'La livraison n’a pas pu être effectuée.',
}

export default function ClientSpace({ user }: { user: User }) {
  const [params, setParams] = useSearchParams()
  const tab: TabId = TABS.find((t) => t.id === params.get('onglet'))?.id ?? 'reserver'
  const select = (id: TabId) => setParams({ onglet: id }, { replace: true })

  const reservations = useApi<Reservation[]>('reservations')
  const orders = useApi<Order[]>('orders')
  const additions = useApi<Addition[]>('additions')
  const { events } = useRealtime(true)
  const [dismissed, setDismissed] = useState(-1)

  // A live event about my reservation or delivery: refresh the lists and tell me in plain French.
  const latest = events[0]
  const { reload: reloadReservations } = reservations
  const { reload: reloadOrders } = orders
  const { reload: reloadAdditions } = additions
  useEffect(() => {
    if (!latest) return
    reloadReservations()
    reloadOrders()
    reloadAdditions()
    const timer = setTimeout(() => setDismissed(latest.id), 6000)
    return () => clearTimeout(timer)
  }, [latest, reloadReservations, reloadOrders, reloadAdditions])
  const toastText = latest && latest.id !== dismissed ? NOTIFICATIONS[latest.event] : undefined

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  function onTabKey(event: KeyboardEvent) {
    const index = TABS.findIndex((t) => t.id === tab)
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    const next = TABS[(index + delta + TABS.length) % TABS.length].id
    select(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <main className="client">
      <motion.header className="client-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Mon espace</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <div className="tabs" role="tablist" aria-label="Mon espace" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el }} type="button" role="tab" id={`tab-${t.id}`}
            aria-selected={tab === t.id} aria-controls="client-panel" tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'is-active' : ''} onClick={() => select(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <section id="client-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="client-panel">
        {tab === 'reserver' && <BookingForm onBooked={() => reservations.reload()} />}
        {tab === 'commander' && <DeliveryOrder onOrdered={async () => { await orders.reload(); select('commandes') }} />}
        {tab === 'reservations' && (reservations.data
          ? <ReservationList reservations={reservations.data} onChange={reservations.reload} />
          : <Loading failed={reservations.failed} />)}
        {tab === 'commandes' && (orders.data
          ? <OrderList orders={orders.data} onChange={orders.reload} />
          : <Loading failed={orders.failed} />)}
        {tab === 'avis' && (additions.data
          ? <AdditionReviews additions={additions.data} onChange={additions.reload} />
          : <Loading failed={additions.failed} />)}
      </section>

      <div className="toast-region" aria-live="polite">
        <AnimatePresence mode="wait">
          {toastText && (
            <motion.p key={latest!.id} className="toast" initial={{ opacity: 0, transform: 'translateY(12px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
              {toastText}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </main>
  )
}

function Loading({ failed }: { failed: boolean }) {
  return failed
    ? <p className="form-error" role="alert">Impossible de charger ces informations. Réessayez dans un instant.</p>
    : <p className="empty" role="status">Chargement…</p>
}
