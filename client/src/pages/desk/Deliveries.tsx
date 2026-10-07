import { MapPin, Phone } from 'lucide-react'
import { useState } from 'react'

import { api, formatDateTime, formatPrice, toErrors, type Order, type User } from '../../api'

function AssignForm({ order, drivers, onChange }: { order: Order; drivers: User[]; onChange: () => void }) {
  const available = drivers.filter((d) => d.availability === 'AVAILABLE')
  const [driver, setDriver] = useState<number | ''>('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const chosen = available.some((d) => d.id === driver) ? driver : (available[0]?.id ?? '')

  async function assign() {
    setPending(true)
    setError('')
    try {
      await api('orderAssign', { id: order.id, method: 'POST', body: { deliverer: chosen } })
      onChange()
    } catch (e) {
      const errors = toErrors(e, 'Attribution impossible.')
      setError(errors.form ?? Object.values(errors)[0])
      onChange()  // the driver may have just been taken by someone else
    } finally {
      setPending(false)
    }
  }

  if (available.length === 0) return <p className="muted">Aucun livreur disponible pour le moment.</p>
  return (
    <div className="assign">
      <label className="sr-only" htmlFor={`driver-${order.id}`}>Livreur pour la commande n°{order.id}</label>
      <select id={`driver-${order.id}`} value={chosen} onChange={(e) => setDriver(Number(e.target.value))}>
        {available.map((d) => <option key={d.id} value={d.id}>{d.first_name || d.username}</option>)}
      </select>
      <button type="button" className="btn btn-ink btn-small" disabled={pending} onClick={assign}>Attribuer</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}

function DeliveryCard({ order, drivers, onChange }: { order: Order; drivers: User[]; onChange: () => void }) {
  return (
    <li className="card desk-card">
      <div className="card-head">
        <h3>Commande n°{order.id}</h3>
        <span className={`badge is-${order.status.toLowerCase()}`}>
          {order.status === 'PENDING' ? 'À attribuer' : `En route avec ${order.deliverer_name ?? 'le livreur'}`}
        </span>
      </div>
      <p className="desk-client">
        <strong>{order.client_name}</strong>
        {order.client_phone && <a href={`tel:${order.client_phone}`}><Phone aria-hidden="true" size={14} /> {order.client_phone}</a>}
      </p>
      <p><MapPin aria-hidden="true" size={14} className="inline-icon" /> {order.delivery_address}</p>
      <p className="muted">{order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')} · {formatPrice(order.total)} · {formatDateTime(order.created_at)}</p>
      {order.status === 'PENDING' && <AssignForm order={order} drivers={drivers} onChange={onChange} />}
    </li>
  )
}

export default function Deliveries({ orders, drivers, onChange }: { orders: Order[]; drivers: User[]; onChange: () => void }) {
  const waiting = orders.filter((o) => o.status === 'PENDING')
  const onTheWay = orders.filter((o) => o.status === 'DELIVERING')
  return (
    <div className="desk-deliveries">
      <section aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="desk-section-title">À attribuer</h2>
        {waiting.length === 0 ? <p className="empty">Aucune livraison en attente.</p> : (
          <ul className="card-list">{waiting.map((o) => <DeliveryCard key={o.id} order={o} drivers={drivers} onChange={onChange} />)}</ul>
        )}
      </section>
      <aside aria-labelledby="drivers-title" className="drivers">
        <h2 id="drivers-title" className="desk-section-title">Livreurs</h2>
        <ul className="driver-list">
          {drivers.map((d) => (
            <li key={d.id}>
              <span>{d.first_name || d.username}</span>
              <span className={`badge ${d.availability === 'AVAILABLE' ? 'is-confirmed' : ''}`}>
                {d.availability === 'AVAILABLE' ? 'Disponible' : d.availability === 'BUSY' ? 'En livraison' : 'Hors service'}
              </span>
            </li>
          ))}
        </ul>
        <h2 className="desk-section-title">En route</h2>
        {onTheWay.length === 0 ? <p className="muted">Aucune livraison en cours.</p> : (
          <ul className="card-list">{onTheWay.map((o) => <DeliveryCard key={o.id} order={o} drivers={drivers} onChange={onChange} />)}</ul>
        )}
      </aside>
    </div>
  )
}
