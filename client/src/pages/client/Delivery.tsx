import { useState, type FormEvent } from 'react'

import { api, formatDateTime, formatPrice, toErrors, useMenu, type Errors, type Order } from '../../api'
import MenuPicker from '../../ui/MenuPicker'
import { cartLines, cartTotal, orderItems, productsOf, type Cart } from '../../ui/menu'

const STATUS: Record<Order['status'], string> = {
  PENDING: 'En attente d’un livreur',
  DELIVERING: 'En route',
  DELIVERED: 'Livrée',
  FAILED: 'Livraison échouée',
  CANCELLED: 'Annulée',
  PAID: 'Payée',
}

export function DeliveryOrder({ onOrdered }: { onOrdered: (order: Order) => Promise<void> }) {
  const menu = useMenu()
  const [cart, setCart] = useState<Cart>({})
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  if (menu.status === 'loading') return <p className="empty" role="status">Chargement de la carte…</p>
  if (menu.status === 'error') return <p className="form-error" role="alert">La carte est indisponible pour le moment.</p>

  const products = productsOf(menu.menu)
  const lines = cartLines(products, cart)
  const total = cartTotal(products, cart)

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
          items: orderItems(products, cart),
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
      <MenuPicker products={products} cart={cart} onChange={setCart} />

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
