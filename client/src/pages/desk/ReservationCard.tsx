import { Car, Phone } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'

import { api, formatDateTime, toErrors, type FreeTable, type Reservation } from '../../api'

const STATUS: Record<Reservation['status'], string> = {
  PENDING: 'À valider',
  CONFIRMED: 'Confirmée',
  CHECKED_IN: 'Installée',
  DONE: 'Terminée',
  CANCELLED: 'Annulée par le client',
  NO_SHOW: 'No-show',
}
const PARKING: Record<Reservation['parking_status'], string> = {
  '': '',
  REQUESTED: 'parking demandé',
  SECURED: 'place gardée',
  REFUSED: 'parking refusé',
}

type Panel = 'table' | 'checkin' | 'noshow' | null

/** Tables the reservation could take: same zone, enough seats, free for its slot (and right now at check-in). */
function TablePicker({ reservation, guests, now, value, onChange }: {
  reservation: Reservation; guests: number; now: boolean; value: number | null; onChange: (n: number | null) => void
}) {
  const name = useId()
  const [tables, setTables] = useState<FreeTable[] | null>(null)

  useEffect(() => {
    let current = true
    api<FreeTable[]>('reservationFreeTables', { id: reservation.id, query: { guests, now } })
      .then((list) => {
        if (!current) return
        setTables(list)
        const keep = list.find((t) => t.number === reservation.table_number) ?? list[0]
        onChange(keep?.number ?? null)
      })
      .catch(() => current && setTables([]))
    return () => { current = false }
  }, [reservation.id, reservation.table_number, guests, now, onChange])  // onChange: a stable state setter

  if (tables === null) return <p className="muted" role="status">Recherche des tables…</p>
  if (tables.length === 0) {
    return <p className="field-error" role="alert">Aucune table libre de cette zone pour {guests} personne{guests > 1 ? 's' : ''}.</p>
  }
  return (
    <fieldset className="table-picker">
      <legend>Table</legend>
      {tables.map((t) => (
        <label key={t.number} className={value === t.number ? 'is-selected' : ''}>
          <input type="radio" name={name} checked={value === t.number} onChange={() => onChange(t.number)} />
          <strong>n°{t.number}</strong><span className="muted">{t.capacity} places</span>
        </label>
      ))}
    </fieldset>
  )
}

export default function ReservationCard({ reservation: r, now, onChange }: {
  reservation: Reservation; now: number; onChange: () => void
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const [guests, setGuests] = useState(r.guest_count)
  const [table, setTable] = useState<number | null>(r.table_number)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const open = r.status === 'PENDING' || r.status === 'CONFIRMED'
  const late = open && new Date(r.reservation_time).getTime() < now

  async function run(action: Parameters<typeof api>[0], body?: object) {
    setPending(true)
    setError('')
    try {
      await api(action, { id: r.id, method: 'POST', body })
      setPanel(null)
      onChange()
    } catch (e) {
      const errors = toErrors(e, 'Action impossible.')
      setError(errors.form ?? Object.values(errors)[0])
    } finally {
      setPending(false)
    }
  }

  function toggle(next: Panel) {
    setError('')
    setGuests(r.guest_count)
    setPanel(panel === next ? null : next)
  }

  function submitTable(event: FormEvent) {
    event.preventDefault()
    if (panel === 'checkin') run('reservationCheckIn', { guest_count: guests, table_number: table })
    else run('reservationReassign', { table_number: table })
  }

  return (
    <li className={`card desk-card${late ? ' is-late' : ''}`}>
      <div className="card-head">
        <h3>{formatDateTime(r.reservation_time)}</h3>
        <span className={`badge is-${r.status.toLowerCase()}`}>{STATUS[r.status]}</span>
      </div>
      <p className="desk-client">
        <strong>{r.client_name || r.client_username}</strong>
        {r.client_phone && <a href={`tel:${r.client_phone}`}><Phone aria-hidden="true" size={14} /> {r.client_phone}</a>}
      </p>
      <p className="muted">
        {r.guest_count} pers. · {r.zone === 'VIP' ? 'Salon VIP' : 'Salle'} · Table {r.table_number !== null ? `n°${r.table_number}` : 'à choisir'}
        {r.parking_status && <> · <Car aria-hidden="true" size={14} className="inline-icon" /> {PARKING[r.parking_status]}{r.parking_spot && ` (${r.parking_spot})`}</>}
      </p>
      {late && <p className="desk-late">Heure dépassée : le client n’est pas encore arrivé.</p>}

      {open && (
        <div className="card-actions">
          {r.status === 'PENDING' && (
            <button type="button" className="btn btn-ink btn-small" disabled={pending} onClick={() => run('reservationConfirm')}>Confirmer</button>
          )}
          {r.status === 'CONFIRMED' && (
            <button type="button" className="btn btn-ink btn-small" aria-expanded={panel === 'checkin'} onClick={() => toggle('checkin')}>Check-in</button>
          )}
          <button type="button" className="btn btn-link" aria-expanded={panel === 'table'} onClick={() => toggle('table')}>Changer de table</button>
          {late && <button type="button" className="btn btn-link" aria-expanded={panel === 'noshow'} onClick={() => toggle('noshow')}>No-show</button>}
        </div>
      )}

      {(panel === 'table' || panel === 'checkin') && (
        <form className="desk-panel" onSubmit={submitTable}>
          {panel === 'checkin' && (
            <div className="field desk-guests">
              <label htmlFor={`guests-${r.id}`}>Personnes présentes</label>
              <input id={`guests-${r.id}`} type="number" min={1} max={20} value={guests}
                onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          )}
          <TablePicker reservation={r} guests={guests} now={panel === 'checkin'} value={table} onChange={setTable} />
          <div className="card-actions">
            <button type="submit" className="btn btn-ink btn-small" disabled={pending || table === null}>
              {panel === 'checkin' ? 'Installer' : 'Attribuer cette table'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setPanel(null)}>Fermer</button>
          </div>
        </form>
      )}

      {panel === 'noshow' && (
        <div className="desk-panel card-actions">
          <button type="button" className="btn btn-danger btn-small" disabled={pending} onClick={() => run('reservationNoShow')}>
            Confirmer le no-show
          </button>
          <button type="button" className="btn btn-link" onClick={() => setPanel(null)}>Garder</button>
        </div>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}
