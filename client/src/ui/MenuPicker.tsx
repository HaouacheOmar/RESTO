import { Minus, Plus } from 'lucide-react'

import { formatPrice } from '../api'
import { bump, type Cart, type Product } from './menu'

/** Today's Menu with a − / count / + stepper per product. */
export default function MenuPicker({ products, cart, onChange, label = 'Carte' }: {
  products: Product[]; cart: Cart; onChange: (cart: Cart) => void; label?: string
}) {
  return (
    <ul className="product-list" aria-label={label}>
      {products.map((p) => (
        <li key={p.key} className="product">
          <div>
            {p.note && <p className="eyebrow">{p.note}</p>}
            <h3>{p.name}</h3>
            <p className="muted">{formatPrice(p.price)}</p>
          </div>
          <div className="stepper" role="group" aria-label={`Quantité de ${p.name}`}>
            <button type="button" onClick={() => onChange(bump(cart, p.key, -1))} disabled={!cart[p.key]}
              aria-label={`Retirer un ${p.name}`}>
              <Minus aria-hidden="true" size={16} />
            </button>
            <output aria-live="polite">{cart[p.key] ?? 0}</output>
            <button type="button" onClick={() => onChange(bump(cart, p.key, 1))} aria-label={`Ajouter un ${p.name}`}>
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
