import { Star } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { api, formatDate, formatPrice, toErrors, type Addition, type ReviewTarget } from '../../api'

interface Target extends ReviewTarget { key: string; label: string; kind: string }

const ROLE_LABEL: Record<string, string> = { SERVER: 'Votre serveur', DELIVERER: 'Votre livreur' }

function targetsOf(addition: Addition): Target[] {
  return [
    { key: 'restaurant', label: 'Le restaurant', kind: 'Expérience', dish: null, daily_special: null, staff: null },
    ...addition.items.map((i) => ({
      key: `i${i.dish}-${i.daily_special}`, label: i.name, kind: i.daily_special ? 'Plat du jour' : 'Plat',
      dish: i.dish, daily_special: i.daily_special, staff: null,
    })),
    ...addition.staff.map((s) => ({
      key: `s${s.id}`, label: s.name, kind: ROLE_LABEL[s.role] ?? 'Équipe', dish: null, daily_special: null, staff: s.id,
    })),
  ]
}

const sameTarget = (a: ReviewTarget, b: ReviewTarget) =>
  a.dish === b.dish && a.daily_special === b.daily_special && a.staff === b.staff

function Stars({ value, label }: { value: number; label: string }) {
  return (
    <span className="stars" role="img" aria-label={`${label} : ${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden="true" size={16} className={n <= value ? 'is-on' : ''} />)}
    </span>
  )
}

function ReviewForm({ addition, target, onDone }: { addition: Addition; target: Target; onDone: () => void }) {
  const id = useId()
  const [rating, setRating] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rating) return setError('Choisissez une note.')
    setPending(true)
    try {
      await api('reviews', {
        method: 'POST',
        body: {
          addition: addition.id, rating, comment: String(new FormData(event.currentTarget).get('comment') ?? ''),
          dish: target.dish, daily_special: target.daily_special, staff: target.staff,
        },
      })
      onDone()
    } catch (e) {
      const errors = toErrors(e, 'Avis impossible.')
      setError(errors.form ?? Object.values(errors)[0])
      setPending(false)
    }
  }

  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <fieldset className="rating">
        <legend className="sr-only">Note pour {target.label}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= rating ? 'is-on' : ''}>
            <input type="radio" name={`${id}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} />
            <Star aria-hidden="true" size={22} />
            <span className="sr-only">{n} sur 5</span>
          </label>
        ))}
      </fieldset>
      <label className="sr-only" htmlFor={`${id}-comment`}>Commentaire pour {target.label}</label>
      <input id={`${id}-comment`} name="comment" placeholder="Un mot ? (facultatif)" maxLength={500} />
      <button type="submit" className="btn btn-ink btn-small" disabled={pending}>{pending ? '…' : 'Envoyer'}</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  )
}

export function AdditionReviews({ additions, onChange }: { additions: Addition[]; onChange: () => void }) {
  const [now] = useState(() => Date.now())
  if (additions.length === 0) {
    return <p className="empty">Vos additions apparaîtront ici après votre premier repas ou votre première livraison.</p>
  }
  return (
    <ul className="card-list">
      {additions.map((a) => {
        const open = new Date(a.reviewable_until).getTime() > now
        return (
          <li key={a.id} className="card">
            <div className="card-head">
              <h3>{a.table_number !== null ? `Table n°${a.table_number}` : 'Livraison'} · {formatDate(a.created_at)}</h3>
              <span className="badge">{formatPrice(a.amount)}</span>
            </div>
            {!open && <p className="muted">Les avis sont possibles pendant 7 jours après le paiement.</p>}
            <ul className="targets">
              {targetsOf(a).map((t) => {
                const done = a.reviews.find((r) => sameTarget(r, t))
                if (!done && !open) return null
                return (
                  <li key={t.key} className="target">
                    <div><p className="eyebrow">{t.kind}</p><p className="target-name">{t.label}</p></div>
                    {done ? <Stars value={done.rating} label="Votre note" /> : <ReviewForm addition={a} target={t} onDone={onChange} />}
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}
