import { motion } from 'motion/react'
import { Car, Phone } from 'lucide-react'
import { useCallback, useId, useState, type FormEvent } from 'react'

import { api, formatDateTime, toErrors, useApi, type Reservation, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import './parking.css'

const TAB_IDS = ['demandes', 'places'] as const
const SLOT_MS = 2 * 60 * 60 * 1000  // a reservation holds its table (and spot) for 2 h, as on the backend
const ACTIVE: Reservation['status'][] = ['PENDING', 'CONFIRMED', 'CHECKED_IN']

const NOTIFICATIONS: Notifications = {
  parking_requested: (p) => `Nouvelle demande de place : ${p.client_name || p.client_username}, ${formatDateTime(String(p.reservation_time))}.`,
  reservation_cancelled: 'Réservation annulée : la place est libérée.',
  reservation_no_show: 'No-show : la place est libérée.',
}

/** Spots already secured by other reservations whose 2 h slot overlaps this one. */
function takenSpots(all: Reservation[], r: Reservation) {
  const t = new Date(r.reservation_time).getTime()
  return all.filter((o) => o.id !== r.id && o.parking_status === 'SECURED' && ACTIVE.includes(o.status)
    && Math.abs(new Date(o.reservation_time).getTime() - t) < SLOT_MS).map((o) => o.parking_spot)
}

function Request({ reservation: r, taken, onChange }: { reservation: Reservation; taken: string[]; onChange: () => void }) {
  const id = useId()
  const [error, setError] = useState('')
  const [refusing, setRefusing] = useState(false)
  const [pending, setPending] = useState(false)

  async function run(endpoint: 'parkingConfirm' | 'parkingRefuse', body?: object) {
    setPending(true)
    setError('')
    try {
      await api(endpoint, { id: r.id, method: 'POST', body })
      onChange()
    } catch (e) {
      const errors = toErrors(e, 'Action impossible.')
      setError(errors.form ?? Object.values(errors)[0])
      setPending(false)
    }
  }

  function secure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const spot = String(new FormData(event.currentTarget).get('spot')).trim()
    if (!spot) return setError('Indiquez le numéro de la place.')
    if (taken.includes(spot)) return setError(`La place ${spot} est déjà prise sur ce créneau.`)
    run('parkingConfirm', { parking_spot: spot })
  }

  return (
    <li className="card">
      <div className="card-head">
        <h3>{formatDateTime(r.reservation_time)}</h3>
        <span className="badge"><Car aria-hidden="true" size={14} />&nbsp;Demande</span>
      </div>
      <p className="desk-client">
        <strong>{r.client_name || r.client_username}</strong>
        {r.client_phone && <a href={`tel:${r.client_phone}`}><Phone aria-hidden="true" size={14} /> {r.client_phone}</a>}
      </p>
      <p className="muted">{r.guest_count} pers. · {r.zone === 'VIP' ? 'Salon VIP' : 'Salle'}</p>

      <form className="spot-form" onSubmit={secure} noValidate>
        <div className="field">
          <label htmlFor={`${id}-spot`}>Place</label>
          <input id={`${id}-spot`} name="spot" maxLength={20} placeholder="ex. A3" autoComplete="off"
            aria-describedby={`${id}-taken`} />
          <p id={`${id}-taken`} className="field-hint">
            {taken.length ? `Déjà prises sur ce créneau : ${taken.join(', ')}` : 'Aucune place prise sur ce créneau.'}
          </p>
        </div>
        <div className="card-actions">
          <button type="submit" className="btn btn-ink btn-small" disabled={pending}>Garder la place</button>
          {refusing ? (
            <>
              <button type="button" className="btn btn-danger btn-small" disabled={pending} onClick={() => run('parkingRefuse')}>
                Confirmer : parking complet
              </button>
              <button type="button" className="btn btn-link" onClick={() => setRefusing(false)}>Retour</button>
            </>
          ) : (
            <button type="button" className="btn btn-link" onClick={() => setRefusing(true)}>Parking complet</button>
          )}
        </div>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}

function Secured({ reservations }: { reservations: Reservation[] }) {
  if (reservations.length === 0) return <p className="empty">Aucune place gardée à venir.</p>
  return (
    <ul className="card-list">
      {reservations.map((r) => (
        <li key={r.id} className="card spot-card">
          <span className="spot" aria-label={`Place ${r.parking_spot}`}>{r.parking_spot}</span>
          <div>
            <h3>{formatDateTime(r.reservation_time)}</h3>
            <p><strong>{r.client_name || r.client_username}</strong> · {r.guest_count} pers.</p>
            <p className="muted">{r.status === 'CHECKED_IN' ? 'Client arrivé' : r.status === 'CONFIRMED' ? 'Réservation confirmée' : 'Réservation à valider'}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function ParkingSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const reservations = useApi<Reservation[]>('reservations')
  const { reload } = reservations
  const refresh = useCallback(() => { reload() }, [reload])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  const all = reservations.data ?? []
  const requests = all.filter((r) => r.parking_status === 'REQUESTED' && ['PENDING', 'CONFIRMED'].includes(r.status))
  const secured = all.filter((r) => r.parking_status === 'SECURED' && ACTIVE.includes(r.status))

  return (
    <main className="desk">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Parking</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={[
        { id: 'demandes', label: 'Demandes', count: requests.length },
        { id: 'places', label: 'Places gardées', count: secured.length },
      ]} current={tab} onSelect={select} label="Parking">
        {!reservations.data ? <Loading failed={reservations.failed} />
          : tab === 'demandes'
            ? (requests.length === 0
              ? <p className="empty">Aucune demande en attente.</p>
              : <ul className="card-list">
                  {requests.map((r) => <Request key={r.id} reservation={r} taken={takenSpots(all, r)} onChange={refresh} />)}
                </ul>)
            : <Secured reservations={secured} />}
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
