import { motion } from 'motion/react'
import { Car, Crown, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api, formatDateTime, toErrors, type Errors, type Reservation, type Zone } from '../../api'
import { rise } from '../../motion'

// Opening hours shown on the landing page: Tuesday–Sunday, 12h–15h and 19h–23h. A table is held 2 h.
const SLOTS = ['12:00', '12:30', '13:00', '19:00', '19:30', '20:00', '20:30', '21:00']
const CLOSED_DAY = 1 // Monday

const STATUS: Record<Reservation['status'], string> = {
  PENDING: 'En attente de validation',
  CONFIRMED: 'Confirmée',
  CHECKED_IN: 'Vous êtes installés',
  DONE: 'Terminée',
  CANCELLED: 'Annulée',
  NO_SHOW: 'Non honorée',
}
const PARKING: Record<Reservation['parking_status'], string> = {
  '': '',
  REQUESTED: 'Place de parking demandée',
  SECURED: 'Place de parking gardée',
  REFUSED: 'Parking complet : prévoyez de stationner à proximité',
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function BookingForm({ onBooked }: { onBooked: (reservation: Reservation) => void }) {
  const [zone, setZone] = useState<Zone>('STANDARD')
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)
  const [booked, setBooked] = useState<Reservation | null>(null)
  const [today] = useState(() => isoDate(new Date()))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const date = String(form.get('date'))
    const when = new Date(`${date}T${form.get('time')}`)
    if (!date || Number.isNaN(when.getTime())) return setErrors({ date: 'Choisissez une date et une heure.' })
    if (when.getDay() === CLOSED_DAY) return setErrors({ date: 'Le restaurant est fermé le lundi.' })
    if (when <= new Date()) return setErrors({ date: 'Choisissez un créneau à venir.' })
    setPending(true)
    setErrors({})
    try {
      const reservation = await api<Reservation>('reservations', {
        method: 'POST',
        body: {
          reservation_time: when.toISOString(),
          guest_count: Number(form.get('guest_count')),
          zone,
          has_vehicle: form.get('has_vehicle') === 'on',
        },
      })
      setBooked(reservation)
      onBooked(reservation)
    } catch (error) {
      setErrors(toErrors(error, 'Réservation impossible.'))
    } finally {
      setPending(false)
    }
  }

  if (booked) {
    return (
      <motion.div className="confirm-card" variants={rise} initial="hidden" animate="show" role="status">
        <p className="eyebrow">Demande envoyée</p>
        <h3>Table n°{booked.table_number} proposée</h3>
        <p>{formatDateTime(booked.reservation_time)} · {booked.guest_count} personne{booked.guest_count > 1 ? 's' : ''}
          {booked.zone === 'VIP' ? ' · Salon VIP' : ''}</p>
        <p className="muted">Nous vous prévenons ici dès que l’équipe la confirme{booked.has_vehicle ? ', ainsi que pour votre place de parking' : ''}.</p>
        <button type="button" className="btn btn-outline" onClick={() => setBooked(null)}>Nouvelle réservation</button>
      </motion.div>
    )
  }

  return (
    <form className="client-form" onSubmit={submit} noValidate>
      {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      <div className="field-row">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" min={today} required aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? 'date-error' : 'date-hint'} />
          {errors.date
            ? <p id="date-error" className="field-error">{errors.date}</p>
            : <p id="date-hint" className="field-hint">Du mardi au dimanche.</p>}
        </div>
        <div className="field">
          <label htmlFor="time">Heure</label>
          <select id="time" name="time" defaultValue="20:00">
            <optgroup label="Déjeuner">{SLOTS.filter((s) => s < '15:00').map((s) => <option key={s}>{s}</option>)}</optgroup>
            <optgroup label="Dîner">{SLOTS.filter((s) => s >= '19:00').map((s) => <option key={s}>{s}</option>)}</optgroup>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="guest_count">Nombre de personnes</label>
        <input id="guest_count" name="guest_count" type="number" min={1} max={12} defaultValue={2} required
          aria-invalid={errors.guest_count ? true : undefined} />
        {errors.guest_count && <p className="field-error">{errors.guest_count}</p>}
      </div>

      <fieldset className="choice-group">
        <legend>Espace</legend>
        {([['STANDARD', 'Salle', 'Ambiance feutrée, pour tous les jours.', Users],
          ['VIP', 'Salon VIP', 'Espace à part et service dédié.', Crown]] as const).map(([value, title, text, Icon]) => (
          <label key={value} className={`choice${zone === value ? ' is-selected' : ''}`}>
            <input type="radio" name="zone" value={value} checked={zone === value} onChange={() => setZone(value)} />
            <Icon aria-hidden="true" size={22} strokeWidth={1.25} />
            <span><strong>{title}</strong><span className="muted">{text}</span></span>
          </label>
        ))}
      </fieldset>

      <label className="check">
        <input type="checkbox" name="has_vehicle" />
        <Car aria-hidden="true" size={20} strokeWidth={1.25} />
        <span>Je viens en voiture <span className="muted">— nous vous gardons une place si possible</span></span>
      </label>

      <button className="btn btn-ink" type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Demander cette table'}</button>
    </form>
  )
}

export function ReservationList({ reservations, onChange }: { reservations: Reservation[]; onChange: () => void }) {
  const [confirming, setConfirming] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function cancel(id: number) {
    try {
      await api('reservationCancel', { id, method: 'POST' })
      setConfirming(null)
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Annulation impossible.').form ?? 'Annulation impossible.')
    }
  }

  if (reservations.length === 0) return <p className="empty">Aucune réservation pour l’instant.</p>
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="card-list">
        {reservations.map((r) => (
          <li key={r.id} className="card">
            <div className="card-head">
              <h3>{formatDateTime(r.reservation_time)}</h3>
              <span className={`badge is-${r.status.toLowerCase()}`}>{STATUS[r.status]}</span>
            </div>
            <p className="muted">
              {r.guest_count} personne{r.guest_count > 1 ? 's' : ''} · {r.zone === 'VIP' ? 'Salon VIP' : 'Salle'}
              {r.table_number !== null && ` · Table n°${r.table_number}`}
            </p>
            {r.parking_status && (
              <p className="muted">{PARKING[r.parking_status]}{r.parking_spot && ` (place ${r.parking_spot})`}</p>
            )}
            {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
              confirming === r.id ? (
                <div className="card-actions">
                  <button type="button" className="btn btn-danger" onClick={() => cancel(r.id)}>Confirmer l’annulation</button>
                  <button type="button" className="btn btn-link" onClick={() => setConfirming(null)}>Garder</button>
                </div>
              ) : (
                <div className="card-actions">
                  <button type="button" className="btn btn-link" onClick={() => setConfirming(r.id)}>Annuler la réservation</button>
                </div>
              )
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
