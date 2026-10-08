import { useState } from 'react'

import { api, errorText, formatDate, useApi, type StockRequest, type Supplier } from '../../api'
import Loading from '../../ui/Loading'

const STATUS: Record<StockRequest['status'], string> = { PENDING: 'À approuver', APPROVED: 'Commandée', FULFILLED: 'Reçue' }

function RequestCard({ request: r, suppliers, onChange }: { request: StockRequest; suppliers: Supplier[]; onChange: () => void }) {
  const [supplier, setSupplier] = useState<number | ''>(suppliers[0]?.id ?? '')
  const [error, setError] = useState('')
  const supplierName = suppliers.find((s) => s.id === r.supplier)?.name

  async function run(action: 'stockApprove' | 'stockFulfill') {
    setError('')
    try {
      await api(action, { id: r.id, method: 'POST', body: action === 'stockApprove' ? { supplier } : undefined })
      onChange()
    } catch (e) {
      setError(errorText(e, 'Action impossible.'))
    }
  }

  return (
    <li className="card">
      <div className="card-head">
        <h3>{r.ingredient_name} · {Number(r.quantity_requested)}</h3>
        <span className={`badge ${r.status === 'FULFILLED' ? 'is-confirmed' : ''}`}>{STATUS[r.status]}</span>
      </div>
      <p className="muted">Demandée le {formatDate(r.created_at)}{supplierName && ` · fournisseur : ${supplierName}`}</p>
      {r.status === 'PENDING' && (suppliers.length === 0
        ? <p className="muted">Ajoutez d’abord un fournisseur d’ingrédients (onglet Réglages).</p>
        : (
          <div className="assign">
            <label className="sr-only" htmlFor={`supplier-${r.id}`}>Fournisseur</label>
            <select id={`supplier-${r.id}`} value={supplier} onChange={(e) => setSupplier(Number(e.target.value))}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn btn-ink btn-small" onClick={() => run('stockApprove')}>Approuver et commander</button>
          </div>
        ))}
      {r.status === 'APPROVED' && (
        <div className="card-actions">
          <button type="button" className="btn btn-ink btn-small" onClick={() => run('stockFulfill')}>Marquer comme reçue</button>
          <span className="muted">La rupture reste levée par le gestionnaire de stock.</span>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}

export default function Restock({ onChange }: { onChange: () => void }) {
  const requests = useApi<StockRequest[]>('stockRequests')
  const suppliers = useApi<Supplier[]>('suppliers')
  if (!requests.data || !suppliers.data) return <Loading failed={requests.failed || suppliers.failed} />
  const ingredientSuppliers = suppliers.data.filter((s) => s.category === 'INGREDIENTS')
  const reload = () => { requests.reload(); onChange() }
  const open = requests.data.filter((r) => r.status !== 'FULFILLED')
  const done = requests.data.filter((r) => r.status === 'FULFILLED').slice(0, 10)
  return (
    <section aria-labelledby="restock-title">
      <h2 id="restock-title" className="desk-section-title">Demandes de réapprovisionnement</h2>
      {open.length === 0 ? <p className="empty">Aucune demande en cours.</p> : (
        <ul className="card-list">{open.map((r) => <RequestCard key={r.id} request={r} suppliers={ingredientSuppliers} onChange={reload} />)}</ul>
      )}
      {done.length > 0 && (
        <>
          <h2 className="desk-section-title restock-done">Reçues récemment</h2>
          <ul className="card-list">{done.map((r) => <RequestCard key={r.id} request={r} suppliers={suppliers.data!} onChange={reload} />)}</ul>
        </>
      )}
    </section>
  )
}
