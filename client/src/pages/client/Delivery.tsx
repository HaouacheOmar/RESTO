import { Minus, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api, formatDateTime, formatPrice, toErrors, useMenu, type Errors, type Order } from '../../api'

const STATUS: Record<Order['status'], string> = {
  PENDING: 'En attente d’un livreur',
  DELIVERING: 'En route',
  DELIVERED: 'Livrée',
  FAILED: 'Livraison échouée',
  CANCELLED: 'Annulée',
  PAID: 'Payée',
}

interface Product { key: string; dish?: number; daily_special?: number; name: string; price: string; note?: string }

export function DeliveryOrder({ onOrdered }: { onOrdered: (order: Order) => Promise<void> }) {
  const menu = useMenu()
  const [cart, setCart] = useState<Record<string, number>>({})
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  if (menu.status === 'loading') return <p className="empty" role="status">Chargement de la carte…</p>
  if (menu.status === 'error') return <p className="form-error" role="alert">La carte est indisponible pour le moment.</p>

  const special = menu.menu.plat_du_jour
  const products: Product[] = [
    ...(special ? [{ key: `s${special.id}`, daily_special: special.id, name: special.name, price: special.price, note: 'Plat du jour' }] : []),
    ...menu.menu.carte.map((d) => ({ key: `d${d.id}`, dish: d.id, name: d.name, price: d.price })),
  ]
  const lines = products.filter((p) => cart[p.key])
  const total = lines.reduce((sum, p) => sum + Number(p.price) * cart[p.key], 0)
  const change = (key: string, delta: number) =>
    setCart((c) => ({ ...c, [key]: Math.max(0, Math.min(20, (c[key] ?? 0) + delta)) }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = String(new FormData(event.currentTarget).get('delivery_address')).trim()
    if (!address) return setErrors({ delivery_address: 'Indiquez l’adresse de livraison.' })
    setPending(true)
    setErrors({})
    try {
      const order = await api<Order>('orders', {
        method: 'POST',
        body: {
          delivery_address: address,
          items: lines.map((p) => ({ dish: p.dish, daily_special: p.daily_special, quantity: cart[p.key] })),
        },
      })
      setCart({})
      await onOrdered(order)  // the list already shows the new order when the tab switches
    } catch (error) {
      const e = toErrors(error, 'Commande impossible.')
      setErrors(e.items ? { form: 'Un plat n’est plus disponible : mettez votre panier à jour.' } : e)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="delivery">
      <ul className="product-list" aria-label="Carte">
        {products.map((p) => (
          <li key={p.key} className="product">
            <div>
              {p.note && <p className="eyebrow">{p.note}</p>}
              <h3>{p.name}</h3>
              <p className="muted">{formatPrice(p.price)}</p>
            </div>
            <div className="stepper" role="group" aria-label={`Quantité de ${p.name}`}>
              <button type="button" onClick={() => change(p.key, -1)} disabled={!cart[p.key]} aria-label={`Retirer un ${p.name}`}>
                <Minus aria-hidden="true" size={16} />
              </button>
              <output aria-live="polite">{cart[p.key] ?? 0}</output>
              <button type="button" onClick={() => change(p.key, 1)} aria-label={`Ajouter un ${p.name}`}>
                <Plus aria-hidden="true" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="cart" onSubmit={submit} noValidate aria-labelledby="cart-title">
        <h3 id="cart-title">Votre commande</h3>
        {lines.length === 0 ? <p className="muted">Ajoutez des plats depuis la carte.</p> : (
          <ul className="cart-lines">
            {lines.map((p) => (
              <li key={p.key}><span>{cart[p.key]} × {p.name}</span><span>{formatPrice(String(Number(p.price) * cart[p.key]))}</span></li>
            ))}
          </ul>
        )}
        <p className="cart-total"><span>Total</span><strong>{formatPrice(String(total))}</strong></p>
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <div className="field">
          <label htmlFor="delivery_address">Adresse de livraison</label>
          <textarea id="delivery_address" name="delivery_address" rows={3} autoComplete="street-address"
            aria-invalid={errors.delivery_address ? true : undefined}
            aria-describedby={errors.delivery_address ? 'address-error' : undefined} />
          {errors.delivery_address && <p id="address-error" className="field-error">{errors.delivery_address}</p>}
        </div>
        <p className="field-hint">Paiement à la livraison, en espèces ou par carte.</p>
        <button className="btn btn-ink" type="submit" disabled={pending || lines.length === 0}>
          {pending ? 'Envoi…' : 'Commander'}
        </button>
      </form>
    </div>
  )
}

export function OrderList({ orders, onChange }: { orders: Order[]; onChange: () => void }) {
  const [error, setError] = useState('')

  async function cancel(id: number) {
    try {
      await api('orderCancel', { id, method: 'POST' })
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Annulation impossible : un livreur est peut-être déjà en route.').form ?? '')
    }
  }

  if (orders.length === 0) return <p className="empty">Aucune commande pour l’instant.</p>
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="card-list">
        {orders.map((o) => (
          <li key={o.id} className="card">
            <div className="card-head">
              <h3>Commande n°{o.id}</h3>
              <span className={`badge is-${o.status.toLowerCase()}`}>
                {STATUS[o.status]}{o.status === 'DELIVERING' && o.deliverer_name ? ` avec ${o.deliverer_name}` : ''}
              </span>
            </div>
            <p className="muted">{formatDateTime(o.created_at)} · {formatPrice(o.total)}</p>
            <p>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
            {o.status === 'PENDING' && (
              <div className="card-actions">
                <button type="button" className="btn btn-link" onClick={() => cancel(o.id)}>Annuler la commande</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
