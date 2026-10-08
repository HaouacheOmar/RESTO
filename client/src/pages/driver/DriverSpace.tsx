import { motion } from 'motion/react'
import { Banknote, CreditCard, MapPin, Navigation, Phone } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api, formatDateTime, formatPrice, toErrors, useApi, type Order, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Toast from '../../ui/Toast'
import './driver.css'

const NOTIFICATIONS: Notifications = {
  delivery_assigned: (p) => `Nouvelle livraison pour ${p.client_name ?? 'un client'} : ${p.delivery_address}.`,
}

const AVAILABILITY: Record<NonNullable<User['availability']>, string> = {
  AVAILABLE: 'Disponible',
  BUSY: 'En livraison',
  OFFLINE: 'Hors service',
}

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

function errorOf(e: unknown, fallback: string) {
  const errors = toErrors(e, fallback)
  return errors.form ?? Object.values(errors)[0]
}

function Shift({ me, onChange }: { me: User; onChange: () => void }) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const on = me.availability !== 'OFFLINE'

  async function toggle() {
    setPending(true)
    setError('')
    try {
      await api('availability', { method: 'POST', body: { availability: on ? 'OFFLINE' : 'AVAILABLE' } })
      onChange()
    } catch (e) {
      setError(errorOf(e, 'Changement impossible.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={`shift is-${(me.availability ?? 'OFFLINE').toLowerCase()}`} aria-label="Mon service">
      <div>
        <p className="eyebrow">Mon statut</p>
        <p className="shift-state" role="status">{AVAILABILITY[me.availability ?? 'OFFLINE']}</p>
      </div>
      {me.availability !== 'BUSY' && (
        <button type="button" className={`btn ${on ? 'btn-outline' : 'btn-ink'} btn-small`} disabled={pending} onClick={toggle}>
          {on ? 'Terminer mon service' : 'Commencer mon service'}
        </button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  )
}

function CurrentDelivery({ order, onChange }: { order: Order; onChange: () => void }) {
  const [step, setStep] = useState<'idle' | 'deliver' | 'fail'>('idle')
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function finish(endpoint: 'orderDeliver' | 'orderFail') {
    setPending(true)
    setError('')
    try {
      await api(endpoint, { id: order.id, method: 'POST', body: endpoint === 'orderDeliver' ? { method } : undefined })
      onChange()
    } catch (e) {
      setError(errorOf(e, 'Action impossible.'))
      setPending(false)
    }
  }

  return (
    <motion.article className="card delivery-now" variants={rise} initial="hidden" animate="show" aria-labelledby="now-title">
      <p className="eyebrow">Livraison en cours · commande n°{order.id}</p>
      <h2 id="now-title">{order.client_name}</h2>
      <p className="delivery-address"><MapPin aria-hidden="true" size={18} /> {order.delivery_address}</p>
      <div className="card-actions">
        <a className="btn btn-outline btn-small" href={mapsUrl(order.delivery_address)} target="_blank" rel="noreferrer">
          <Navigation aria-hidden="true" size={16} /> Itinéraire
        </a>
        {order.client_phone && (
          <a className="btn btn-outline btn-small" href={`tel:${order.client_phone}`}><Phone aria-hidden="true" size={16} /> Appeler</a>
        )}
      </div>
      <ul className="delivery-items">
        {order.items.map((i, n) => <li key={n}><span>{i.quantity} × {i.name}</span></li>)}
      </ul>
      <p className="collect"><span>À encaisser</span><strong>{formatPrice(order.total)}</strong></p>

      {step === 'idle' && (
        <div className="card-actions">
          <button type="button" className="btn btn-ink" onClick={() => setStep('deliver')}>Livrée et encaissée</button>
          <button type="button" className="btn btn-link" onClick={() => setStep('fail')}>Livraison échouée</button>
        </div>
      )}
      {step === 'deliver' && (
        <div className="pay-panel">
          <fieldset className="pay-methods">
            <legend>Le client a payé</legend>
            {([['CASH', 'En espèces', Banknote], ['CARD', 'Par carte', CreditCard]] as const).map(([value, label, Icon]) => (
              <label key={value} className={method === value ? 'is-selected' : ''}>
                <input type="radio" name="method" checked={method === value} onChange={() => setMethod(value)} />
                <Icon aria-hidden="true" size={20} strokeWidth={1.5} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="card-actions">
            <button type="button" className="btn btn-ink" disabled={pending} onClick={() => finish('orderDeliver')}>
              {pending ? 'Envoi…' : `Confirmer ${formatPrice(order.total)} encaissés`}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setStep('idle')}>Retour</button>
          </div>
        </div>
      )}
      {step === 'fail' && (
        <div className="pay-panel">
          <p>Client absent ou commande refusée ? Rien n’est encaissé et le gérant est prévenu.</p>
          <div className="card-actions">
            <button type="button" className="btn btn-danger" disabled={pending} onClick={() => finish('orderFail')}>
              Confirmer l’échec
            </button>
            <button type="button" className="btn btn-link" onClick={() => setStep('idle')}>Retour</button>
          </div>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </motion.article>
  )
}

export default function DriverSpace({ user }: { user: User }) {
  const me = useApi<User>('me')
  const orders = useApi<Order[]>('orders')  // a deliverer only ever sees their own deliveries
  const { reload: reloadMe } = me
  const { reload: reloadOrders } = orders
  const refresh = useCallback(() => { reloadMe(); reloadOrders() }, [reloadMe, reloadOrders])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  const current = (orders.data ?? []).filter((o) => o.status === 'DELIVERING')
  const done = (orders.data ?? []).filter((o) => o.status === 'DELIVERED' || o.status === 'FAILED').slice(0, 20)

  return (
    <main className="desk driver">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Livraisons</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      {me.data ? <Shift me={me.data} onChange={refresh} /> : <Loading failed={me.failed} />}

      {!orders.data ? <Loading failed={orders.failed} /> : (
        <>
          {current.length === 0
            ? <p className="empty">{me.data?.availability === 'OFFLINE'
              ? 'Vous êtes hors service : commencez votre service pour recevoir des livraisons.'
              : 'Aucune livraison en cours. Vous serez prévenu dès qu’une commande vous est attribuée.'}</p>
            : current.map((o) => <CurrentDelivery key={o.id} order={o} onChange={refresh} />)}

          {done.length > 0 && (
            <section aria-labelledby="history-title" className="driver-history">
              <h2 id="history-title" className="desk-section-title">Mes dernières livraisons</h2>
              <ul className="card-list">
                {done.map((o) => (
                  <li key={o.id} className="card">
                    <div className="card-head">
                      <h3>{o.client_name}</h3>
                      <span className={`badge is-${o.status.toLowerCase()}`}>{o.status === 'DELIVERED' ? 'Livrée' : 'Échouée'}</span>
                    </div>
                    <p className="muted">{formatDateTime(o.created_at)} · {o.delivery_address} · {formatPrice(o.total)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Toast toast={toast} />
    </main>
  )
}
