import { useState, type FormEvent } from 'react'

import { api, errorText, formatDate, toErrors, useApi, type Errors, type JobApplication, type Role, type User } from '../../api'
import Field from '../../Field'
import Loading from '../../ui/Loading'

const STAFF_ROLES: [Role, string][] = [
  ['RESERVATION_MANAGER', 'Responsable réservation'], ['CHEF', 'Chef'], ['SERVER', 'Serveur'], ['CASHIER', 'Caissier'],
  ['DELIVERER', 'Livreur'], ['PARKING_ATTENDANT', 'Stationneur'], ['STOCK_MANAGER', 'Gestionnaire de stock'],
  ['ADMIN_MANAGER', 'Gérant'],
]
const ROLE_LABEL = Object.fromEntries(STAFF_ROLES) as Record<Role, string>

function NewStaff({ onCreated }: { onCreated: () => void }) {
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setPending(true)
    setErrors({})
    try {
      await api('users', { method: 'POST', body: Object.fromEntries(new FormData(form)) })
      form.reset()
      onCreated()
    } catch (e) {
      setErrors(toErrors(e, 'Création impossible.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="admin-form" onSubmit={submit} noValidate aria-label="Nouveau compte du personnel">
      {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      <div className="field-row">
        <Field label="Prénom" name="first_name" error={errors.first_name} />
        <Field label="Nom" name="last_name" error={errors.last_name} />
      </div>
      <div className="field-row">
        <Field label="Nom d’utilisateur" name="username" required autoComplete="off" error={errors.username} />
        <div className="field">
          <label htmlFor="staff-role">Rôle</label>
          <select id="staff-role" name="role" defaultValue="SERVER">
            {STAFF_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="field-row">
        <Field label="Téléphone" name="phone" type="tel" error={errors.phone} />
        <Field label="Mot de passe provisoire" name="password" type="password" required autoComplete="new-password" error={errors.password} />
      </div>
      <button type="submit" className="btn btn-ink btn-small" disabled={pending}>{pending ? 'Création…' : 'Créer le compte'}</button>
    </form>
  )
}

function Applications({ onChange }: { onChange: () => void }) {
  const applications = useApi<JobApplication[]>('jobApplications')
  const [error, setError] = useState('')
  const pending = (applications.data ?? []).filter((a) => a.status === 'PENDING')

  async function decide(id: number, accept: boolean) {
    setError('')
    try {
      await api(accept ? 'jobAccept' : 'jobReject', { id, method: 'POST' })
      applications.reload()
      if (accept) onChange()
    } catch (e) {
      setError(errorText(e, 'Action impossible.'))
    }
  }

  if (!applications.data) return <Loading failed={applications.failed} />
  if (pending.length === 0) return <p className="muted">Aucune candidature en attente.</p>
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="card-list">
        {pending.map((a) => (
          <li key={a.id} className="card">
            <div className="card-head"><h3>{a.full_name}</h3><span className="badge">{ROLE_LABEL[a.requested_role]}</span></div>
            <p className="muted">{a.phone} · identifiant « {a.username} » · reçue le {formatDate(a.created_at)}</p>
            <div className="card-actions">
              <button type="button" className="btn btn-ink btn-small" onClick={() => decide(a.id, true)}>Embaucher</button>
              <button type="button" className="btn btn-link" onClick={() => decide(a.id, false)}>Refuser</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function Team() {
  const users = useApi<User[]>('users')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const staff = (users.data ?? []).filter((u) => u.role !== 'CLIENT')

  async function setActive(user: User, is_active: boolean) {
    setError('')
    try {
      await api('user', { id: user.id, method: 'PATCH', body: { is_active } })
      users.reload()
    } catch (e) {
      setError(errorText(e, 'Action impossible.'))
    }
  }

  return (
    <div className="admin-grid">
      <section aria-labelledby="staff-title">
        <div className="section-bar">
          <h2 id="staff-title" className="desk-section-title">Personnel</h2>
          <button type="button" className="btn btn-ink btn-small" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {adding ? 'Fermer' : 'Nouveau compte'}
          </button>
        </div>
        {adding && <NewStaff onCreated={() => { setAdding(false); users.reload() }} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!users.data ? <Loading failed={users.failed} /> : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th scope="col">Nom</th><th scope="col">Rôle</th><th scope="col">Statut</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id} className={u.is_active ? '' : 'is-inactive'}>
                    <td><strong>{[u.first_name, u.last_name].join(' ').trim() || u.username}</strong><br /><span className="muted">{u.username}</span></td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.is_active ? (u.role === 'DELIVERER' ? { AVAILABLE: 'Disponible', BUSY: 'En livraison', OFFLINE: 'Hors service' }[u.availability ?? 'OFFLINE'] : 'Actif') : 'Désactivé'}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-link" onClick={() => setActive(u, !u.is_active)}>{u.is_active ? 'Désactiver' : 'Réactiver'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section aria-labelledby="applications-title">
        <h2 id="applications-title" className="desk-section-title">Candidatures</h2>
        <Applications onChange={users.reload} />
      </section>
    </div>
  )
}
