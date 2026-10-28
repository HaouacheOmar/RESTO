import { motion } from 'motion/react'
import { useCallback } from 'react'

import { useApi, usePagedApi, type Addition, type Order, type Reservation, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import LoadMore from '../../ui/LoadMore'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import { BookingForm, ReservationList } from './Booking'
import { DeliveryOrder, OrderList } from './Delivery'
import { AdditionReviews } from './Reviews'
import './client.css'

const TAB_IDS = ['reserver', 'commander', 'reservations', 'commandes', 'avis'] as const
const LABELS = ['Réserver', 'Commander', 'Mes réservations', 'Mes commandes', 'Mes avis']

/** What a live event means for the client, in their words. */
const NOTIFICATIONS: Notifications = {
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
  const [tab, select] = useTab(TAB_IDS)
  const upcoming = useApi<Reservation[]>('reservations', { scope: 'active' })  // soonest first
  const past = usePagedApi<Reservation>('reservations', { scope: 'history' })  // newest first
  const orders = usePagedApi<Order>('orders')
  const additions = usePagedApi<Addition>('additions')

  const { reload: reloadUpcoming } = upcoming
  const { reload: reloadPast } = past
  const { reload: reloadOrders } = orders
  const { reload: reloadAdditions } = additions
  const reloadReservations = useCallback(() => { reloadUpcoming(); reloadPast() }, [reloadUpcoming, reloadPast])
  const refresh = useCallback(() => { reloadReservations(); reloadOrders(); reloadAdditions() },
    [reloadReservations, reloadOrders, reloadAdditions])
  const reservations = upcoming.data && past.items ? [...upcoming.data, ...past.items] : null
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  return (
    <main className="client">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Mon espace</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={TAB_IDS.map((id, i) => ({ id, label: LABELS[i] }))} current={tab} onSelect={select} label="Mon espace">
        {tab === 'reserver' && <BookingForm onBooked={reloadReservations} />}
        {tab === 'commander' && <DeliveryOrder onOrdered={async () => { await orders.reload(); select('commandes') }} />}
        {tab === 'reservations' && (reservations
          ? <><ReservationList reservations={reservations} onChange={reloadReservations} />
              <LoadMore hasMore={past.hasMore} onClick={past.loadMore} /></>
          : <Loading failed={upcoming.failed || past.failed} />)}
        {tab === 'commandes' && (orders.items
          ? <><OrderList orders={orders.items} onChange={orders.reload} />
              <LoadMore hasMore={orders.hasMore} onClick={orders.loadMore} /></>
          : <Loading failed={orders.failed} />)}
        {tab === 'avis' && (additions.items
          ? <><AdditionReviews additions={additions.items} onChange={additions.reload} />
              <LoadMore hasMore={additions.hasMore} onClick={additions.loadMore} /></>
          : <Loading failed={additions.failed} />)}
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
