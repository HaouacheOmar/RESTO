import { useState, type FormEvent } from 'react'

import { api, errorText, useApi, type Supplier, type Table } from '../../api'
import Loading from '../../ui/Loading'

/** Small add-and-list admin block: tables of the dining room, suppliers. */
function useCrud(onDone: () => void) {
  const [error, setError] = useState('')
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError('')
    try {
      await action()
      onDone()
      return true
    } catch (e) {
      setError(errorText(e, fallback))
      return false
    }
  }
  return { error, run }
}

function Tables() {
  const tables = useApi<Table[]>('tables')
  const { error, run } = useCrud(tables.reload)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    if (await run(() => api('tables', { method: 'POST', body: data }), 'Ajout impossible.')) form.reset()
  }

  if (!tables.data) return <Loading failed={tables.failed} />
  return (
    <section aria-labelledby="tables-title">
      <h2 id="tables-title" className="desk-section-title">Tables</h2>
      <form className="inline-form" onSubmit={add} aria-label="Ajouter une table">
        <label>N° <input name="number" type="number" min={1} required /></label>
        <label>Places <input name="capacity" type="number" min={1} required /></label>
        <label>Zone <select name="zone"><option value="STANDARD">Salle</option><option value="VIP">Salon VIP</option></select></label>
        <button type="submit" className="btn btn-ink btn-small">Ajouter</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th scope="col">Table</th><th scope="col">Places</th><th scope="col">Zone</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {tables.data.map((t) => (
              <tr key={t.id}>
                <td>n°{t.number}</td><td>{t.capacity}</td><td>{t.zone === 'VIP' ? 'Salon VIP' : 'Salle'}</td>
                <td className="row-actions">
                  <button type="button" className="btn btn-link" onClick={() => run(() => api('table', { id: t.id, method: 'DELETE' }), 'Suppression impossible.')}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Suppliers() {
  const suppliers = useApi<Supplier[]>('suppliers')
  const { error, run } = useCrud(suppliers.reload)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    if (await run(() => api('suppliers', { method: 'POST', body: data }), 'Ajout impossible.')) form.reset()
  }

  if (!suppliers.data) return <Loading failed={suppliers.failed} />
  return (
    <section aria-labelledby="suppliers-title">
      <h2 id="suppliers-title" className="desk-section-title">Fournisseurs</h2>
      <form className="inline-form" onSubmit={add} aria-label="Ajouter un fournisseur">
        <label>Nom <input name="name" required /></label>
        <label>Type <select name="category"><option value="INGREDIENTS">Ingrédients</option><option value="EQUIPMENT">Matériel</option></select></label>
        <label>Téléphone <input name="contact_phone" type="tel" /></label>
        <button type="submit" className="btn btn-ink btn-small">Ajouter</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Téléphone</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {suppliers.data.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.category === 'INGREDIENTS' ? 'Ingrédients' : 'Matériel'}</td><td>{s.contact_phone || '—'}</td>
                <td className="row-actions">
                  <button type="button" className="btn btn-link" onClick={() => run(() => api('supplier', { id: s.id, method: 'DELETE' }), 'Suppression impossible.')}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Settings() {
  return <div className="admin-grid"><Tables /><Suppliers /></div>
}
