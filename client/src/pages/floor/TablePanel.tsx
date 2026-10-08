import { useState, type FormEvent } from 'react'

import { api, formatDateTime, formatPrice, toErrors, useMenu, type Seance, type Table } from '../../api'
import MenuPicker from '../../ui/MenuPicker'
import { cartLines, cartTotal, orderItems, productsOf, type Cart } from '../../ui/menu'

const time = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function Orders({ seance, onChange }: { seance: Seance; onChange: () => void }) {
  const [confirming, setConfirming] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function cancel(id: number) {
    try {
      await api('orderCancel', { id, method: 'POST' })
      setConfirming(null)
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Annulation impossible.').form ?? 'Annulation impossible.')
    }
  }

  if (seance.orders.length === 0) return <p className="muted">Aucune commande pour l’instant.</p>
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="seance-orders">
        {seance.orders.map((o) => (
          <li key={o.id} className={o.status === 'CANCELLED' ? 'is-cancelled' : ''}>
            <div className="seance-order-head">
              <span>Commande n°{o.id} · {time.format(new Date(o.created_at))}</span>
              <span>{o.status === 'CANCELLED' ? 'Annulée' : formatPrice(o.total)}</span>
            </div>
            <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
            {o.status === 'PENDING' && (confirming === o.id ? (
              <div className="card-actions">
                <button type="button" className="btn btn-danger btn-small" onClick={() => cancel(o.id)}>Confirmer l’annulation</button>
                <button type="button" className="btn btn-link" onClick={() => setConfirming(null)}>Garder</button>
              </div>
            ) : (
              <button type="button" className="btn btn-link" onClick={() => setConfirming(o.id)}>Annuler cette commande</button>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}

function CloseSeance({ seance, onChange }: { seance: Seance; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  async function close() {
    try {
      await api('seanceClose', { id: seance.id, method: 'POST' })
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Impossible de clore la séance.').form ?? '')
    }
  }

  return (
    <div className="card-actions">
      {confirming ? (
        <>
          <button type="button" className="btn btn-danger btn-small" onClick={close}>Confirmer : partis sans commander</button>
          <button type="button" className="btn btn-link" onClick={() => setConfirming(false)}>Retour</button>
        </>
      ) : (
        <button type="button" className="btn btn-link" onClick={() => setConfirming(true)}>Clore la séance sans commande</button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}

/** A table: its open Séance (orders, cancel, close if empty) and the composer for a new order. */
export default function TablePanel({ table, seance, onChange }: { table: Table; seance: Seance | null; onChange: () => void }) {
  const menu = useMenu()
  const [cart, setCart] = useState<Cart>({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const blocked = !seance && table.reserved_at !== null
  const active = seance?.orders.filter((o) => o.status === 'PENDING') ?? []

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (menu.status !== 'ready') return
    const name = String(new FormData(event.currentTarget).get('seance_name') ?? '').trim()
    setPending(true)
    setError('')
    try {
      await api('orders', {
        method: 'POST',
        body: { table_number: table.number, items: orderItems(productsOf(menu.menu), cart), ...(seance ? {} : { seance_name: name }) },
      })
      setCart({})
      onChange()
    } catch (e) {
      const errors = toErrors(e, 'Commande impossible.')
      setError(errors.items ? 'Un plat n’est plus disponible : retirez-le de la commande.' : errors.form ?? Object.values(errors)[0])
    } finally {
      setPending(false)
    }
  }

  const products = menu.status === 'ready' ? productsOf(menu.menu) : []
  const lines = cartLines(products, cart)

  return (
    <section className="table-panel" aria-labelledby="table-title">
      <header className="table-panel-head">
        <p className="eyebrow">{table.zone === 'VIP' ? 'Salon VIP' : 'Salle'} · {table.capacity} places</p>
        <h2 id="table-title">Table n°{table.number}</h2>
        <p className="muted">
          {seance ? <>{seance.name} · installée à {time.format(new Date(seance.opened_at))}</> : 'Table libre'}
        </p>
      </header>

      {seance && (
        <div className="table-panel-block">
          <div className="seance-total"><span>À encaisser</span><strong>{formatPrice(seance.total_due)}</strong></div>
          <Orders seance={seance} onChange={onChange} />
          {active.length === 0 && <CloseSeance seance={seance} onChange={onChange} />}
        </div>
      )}

      {blocked ? (
        <p className="form-error" role="status">
          Réservée pour {formatDateTime(table.reserved_at!)} : installez ces clients à une autre table.
        </p>
      ) : (
        <form className="table-panel-block composer" onSubmit={submit} noValidate>
          <h3>{seance ? 'Nouvelle commande' : 'Installer des clients et commander'}</h3>
          {!seance && (
            <div className="field">
              <label htmlFor="seance_name">Nom (facultatif)</label>
              <input id="seance_name" name="seance_name" maxLength={100} placeholder="Client sur place" autoComplete="off" />
            </div>
          )}
          {menu.status === 'loading' && <p className="muted" role="status">Chargement de la carte…</p>}
          {menu.status === 'error' && <p className="form-error" role="alert">La carte est indisponible.</p>}
          {menu.status === 'ready' && <MenuPicker products={products} cart={cart} onChange={setCart} />}
          <p className="cart-total"><span>{lines.reduce((n, p) => n + cart[p.key], 0)} article(s)</span>
            <strong>{formatPrice(String(cartTotal(products, cart)))}</strong></p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-ink" disabled={pending || lines.length === 0}>
            {pending ? 'Envoi…' : 'Envoyer en caisse'}
          </button>
        </form>
      )}
    </section>
  )
}
