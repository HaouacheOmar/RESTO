import { motion } from 'motion/react'
import { useCallback, useState, type FormEvent } from 'react'

import { api, errorText, formatDate, useApi, type Ingredient, type StockRequest, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import './stock.css'

const TAB_IDS = ['ingredients', 'demandes'] as const
const STATUS: Record<StockRequest['status'], string> = { PENDING: 'En attente du gérant', APPROVED: 'Commandée', FULFILLED: 'Reçue' }

const NOTIFICATIONS: Notifications = {
  stock_request_updated: (p) => (p.status === 'APPROVED'
    ? `${p.ingredient_name} : commandé chez ${p.supplier_name}.`
    : `${p.ingredient_name} : livraison reçue, pensez à mettre le stock à jour.`),
}

function IngredientRow({ ingredient: i, onChange, onRestock }: {
  ingredient: Ingredient; onChange: () => void; onRestock: (i: Ingredient) => void
}) {
  const [qty, setQty] = useState(String(Number(i.quantity_in_stock)))
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const dirty = Number(qty) !== Number(i.quantity_in_stock)

  async function patch(body: object) {
    setError('')
    try {
      await api('ingredient', { id: i.id, method: 'PATCH', body })
      setConfirming(false)
      onChange()
    } catch (e) {
      setError(errorText(e, 'Mise à jour impossible.'))
    }
  }

  return (
    <li className={`card stock-row${i.is_out_of_stock ? ' is-out' : ''}`}>
      <div className="stock-name">
        <h3>{i.name}</h3>
        {i.is_out_of_stock && <span className="badge is-cancelled">Rupture</span>}
        <p className="muted">{i.dishes.length ? `Utilisé dans : ${i.dishes.join(', ')}` : 'Utilisé dans aucun plat de la Carte'}</p>
      </div>
      <form className="stock-qty" onSubmit={(e: FormEvent) => { e.preventDefault(); patch({ quantity_in_stock: qty }) }}>
        <label className="sr-only" htmlFor={`qty-${i.id}`}>Quantité de {i.name} ({i.unit})</label>
        <input id={`qty-${i.id}`} type="number" min={0} step="0.1" value={qty} onChange={(e) => setQty(e.target.value)} />
        <span className="muted">{i.unit}</span>
        {dirty && <button type="submit" className="btn btn-ink btn-small">Enregistrer</button>}
      </form>
      <div className="stock-actions">
        {i.is_out_of_stock ? (
          <>
            <button type="button" className="btn btn-ink btn-small" onClick={() => patch({ is_out_of_stock: false })}>Fin de rupture</button>
            <button type="button" className="btn btn-link" onClick={() => onRestock(i)}>Demander un réappro</button>
          </>
        ) : confirming ? (
          <div className="rupture-confirm" role="group" aria-label={`Confirmer la rupture de ${i.name}`}>
            <p>{i.dishes.length ? <>Retire du menu : <strong>{i.dishes.join(', ')}</strong>.</> : 'Aucun plat n’est concerné.'}</p>
            <div className="card-actions">
              <button type="button" className="btn btn-danger btn-small" onClick={() => patch({ is_out_of_stock: true })}>Déclarer la rupture</button>
              <button type="button" className="btn btn-link" onClick={() => setConfirming(false)}>Annuler</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-link" onClick={() => setConfirming(true)}>Rupture…</button>
        )}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}

function NewIngredient({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    try {
      await api('ingredients', { method: 'POST', body: Object.fromEntries(new FormData(form)) })
      form.reset()
      onCreated()
    } catch (e) {
      setError(errorText(e, 'Ajout impossible.'))
    }
  }
  return (
    <form className="inline-form" onSubmit={submit} aria-label="Nouvel ingrédient">
      <label>Ingrédient <input name="name" required /></label>
      <label>Quantité <input name="quantity_in_stock" type="number" min={0} step="0.1" required /></label>
      <label>Unité <input name="unit" required placeholder="kg, L, unités" /></label>
      <button type="submit" className="btn btn-ink btn-small">Ajouter</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

function Requests({ ingredients, requests, preset, onChange }: {
  ingredients: Ingredient[]; requests: StockRequest[]; preset: number | null; onChange: () => void
}) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    try {
      await api('stockRequests', { method: 'POST', body: Object.fromEntries(new FormData(form)) })
      form.reset()
      onChange()
    } catch (e) {
      setError(errorText(e, 'Demande impossible.'))
    }
  }
  const unit = (id: number) => ingredients.find((i) => i.id === id)?.unit ?? ''
  return (
    <>
      <form className="inline-form" onSubmit={submit} aria-label="Nouvelle demande de réapprovisionnement">
        <label>Ingrédient
          <select name="ingredient" defaultValue={preset ?? undefined} key={preset ?? 'none'}>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}{i.is_out_of_stock ? ' (rupture)' : ''}</option>)}
          </select>
        </label>
        <label>Quantité <input name="quantity_requested" type="number" min={0.1} step="0.1" required /></label>
        <button type="submit" className="btn btn-ink btn-small">Envoyer au gérant</button>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
      {requests.length === 0 ? <p className="empty">Aucune demande pour l’instant.</p> : (
        <ul className="card-list">
          {requests.map((r) => (
            <li key={r.id} className="card">
              <div className="card-head">
                <h3>{r.ingredient_name} · {Number(r.quantity_requested)} {unit(r.ingredient)}</h3>
                <span className={`badge ${r.status === 'FULFILLED' ? 'is-confirmed' : ''}`}>{STATUS[r.status]}</span>
              </div>
              <p className="muted">Demandée le {formatDate(r.created_at)}{r.supplier_name && ` · fournisseur : ${r.supplier_name}`}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default function StockSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const [preset, setPreset] = useState<number | null>(null)
  const ingredients = useApi<Ingredient[]>('ingredients')
  const requests = useApi<StockRequest[]>('stockRequests')
  const { reload: reloadIngredients } = ingredients
  const { reload: reloadRequests } = requests
  const refresh = useCallback(() => { reloadIngredients(); reloadRequests() }, [reloadIngredients, reloadRequests])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  const all = ingredients.data ?? []
  const out = all.filter((i) => i.is_out_of_stock)
  const sorted = [...out, ...all.filter((i) => !i.is_out_of_stock)]  // Ruptures first
  const open = (requests.data ?? []).filter((r) => r.status !== 'FULFILLED').length

  return (
    <main className="desk stock">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Stock</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={[
        { id: 'ingredients', label: 'Ingrédients', count: out.length },
        { id: 'demandes', label: 'Demandes', count: open },
      ]} current={tab} onSelect={select} label="Stock">
        {!ingredients.data || !requests.data ? <Loading failed={ingredients.failed || requests.failed} /> : tab === 'ingredients' ? (
          <>
            <NewIngredient onCreated={refresh} />
            <ul className="card-list">
              {sorted.map((i) => (
                <IngredientRow key={`${i.id}-${i.quantity_in_stock}`} ingredient={i} onChange={refresh}
                  onRestock={(x) => { setPreset(x.id); select('demandes') }} />
              ))}
            </ul>
          </>
        ) : <Requests ingredients={all} requests={requests.data} preset={preset} onChange={refresh} />}
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
