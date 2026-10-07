import { motion } from 'motion/react'
import { useCallback } from 'react'

import { useApi, type Addition, type Order, type Reservation, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
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
  const reservations = useApi<Reservation[]>('reservations')
  const orders = useApi<Order[]>('orders')
  const additions = useApi<Addition[]>('additions')

  const { reload: reloadReservations } = reservations
  const { reload: reloadOrders } = orders
  const { reload: reloadAdditions } = additions
  const refresh = useCallback(() => { reloadReservations(); reloadOrders(); reloadAdditions() },
    [reloadReservations, reloadOrders, reloadAdditions])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  return (
    <main className="client">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Mon espace</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={TAB_IDS.map((id, i) => ({ id, label: LABELS[i] }))} current={tab} onSelect={select} label="Mon espace">
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
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
