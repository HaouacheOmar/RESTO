import { motion } from 'motion/react'
import { Star } from 'lucide-react'
import { useState } from 'react'

import { api, formatDate, formatPrice, toErrors, useApi, type DailySpecial, type User } from '../../api'
import { rise } from '../../motion'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import { useTab } from '../../ui/useTab'
import SpecialForm from './SpecialForm'
import './chef.css'

const TAB_IDS = ['aujourdhui', 'planning', 'historique'] as const
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Stats({ special }: { special: DailySpecial }) {
  return (
    <p className="special-stats">
      <span><strong>{special.sold ?? 0}</strong> servi{(special.sold ?? 0) > 1 ? 's' : ''}</span>
      {special.rating_count ? (
        <span aria-label={`Note moyenne ${special.rating!.toFixed(1)} sur 5, ${special.rating_count} avis`}>
          <Star aria-hidden="true" size={16} className="star-on" /> {special.rating!.toFixed(1).replace('.', ',')} · {special.rating_count} avis
        </span>
      ) : <span className="muted">Pas encore d’avis</span>}
    </p>
  )
}

function Today({ special, today, onChange }: { special: DailySpecial | undefined; today: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (!special) {
    return (
      <section className="special-today" aria-labelledby="today-title">
        <h2 id="today-title" className="desk-section-title">Pas encore de plat du jour pour aujourd’hui</h2>
        <SpecialForm date={today} onSaved={onChange} />
      </section>
    )
  }

  async function setAvailable(is_available: boolean) {
    setPending(true)
    setError('')
    try {
      await api('dailySpecial', { id: special!.id, method: 'PATCH', body: { is_available } })
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Action impossible.').form ?? 'Action impossible.')
    } finally {
      setPending(false)
    }
  }

  if (editing) return <SpecialForm special={special} date={today} onSaved={() => { setEditing(false); onChange() }} onCancel={() => setEditing(false)} />

  return (
    <motion.article className={`card special-card${special.is_available ? '' : ' is-out'}`} variants={rise} initial="hidden" animate="show">
      {special.photo && <img src={special.photo} alt={special.name} className="special-photo" />}
      <div className="special-body">
        <p className="eyebrow">Plat du jour · {formatDate(special.date)}</p>
        <h2>{special.name}</h2>
        {special.description && <p className="muted">{special.description}</p>}
        <p className="special-price-tag">{formatPrice(special.price)}</p>
        <Stats special={special} />
        <p className={`badge ${special.is_available ? 'is-confirmed' : 'is-cancelled'}`} role="status">
          {special.is_available ? 'Au menu' : 'Épuisé : retiré du menu'}
        </p>
        <div className="card-actions">
          {special.is_available
            ? <button type="button" className="btn btn-danger btn-small" disabled={pending} onClick={() => setAvailable(false)}>Épuisé : retirer du menu</button>
            : <button type="button" className="btn btn-ink btn-small" disabled={pending} onClick={() => setAvailable(true)}>Remettre au menu</button>}
          <button type="button" className="btn btn-link" onClick={() => setEditing(true)}>Modifier</button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </motion.article>
  )
}

function Planning({ specials, tomorrow, onChange }: { specials: DailySpecial[]; tomorrow: string; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function remove(id: number) {
    try {
      await api('dailySpecial', { id, method: 'DELETE' })
      setDeleting(null)
      onChange()
    } catch (e) {
      setError(toErrors(e, 'Suppression impossible.').form ?? 'Suppression impossible.')
    }
  }

  return (
    <>
      {adding
        ? <SpecialForm minDate={tomorrow} onSaved={() => { setAdding(false); onChange() }} onCancel={() => setAdding(false)} />
        : <button type="button" className="btn btn-ink btn-small" onClick={() => setAdding(true)}>Planifier un plat du jour</button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {specials.length === 0 ? <p className="empty">Aucun plat du jour planifié.</p> : (
        <ul className="card-list planning-list">
          {specials.map((s) => (
            <li key={s.id} className="card">
              {editing === s.id
                ? <SpecialForm special={s} minDate={tomorrow} onSaved={() => { setEditing(null); onChange() }} onCancel={() => setEditing(null)} />
                : (
                  <>
                    <div className="card-head">
                      <h3>{formatDate(s.date)}</h3>
                      <span className="badge">{formatPrice(s.price)}</span>
                    </div>
                    <p><strong>{s.name}</strong>{s.description && <span className="muted"> · {s.description}</span>}</p>
                    <div className="card-actions">
                      <button type="button" className="btn btn-link" onClick={() => setEditing(s.id)}>Modifier</button>
                      {deleting === s.id ? (
                        <>
                          <button type="button" className="btn btn-danger btn-small" onClick={() => remove(s.id)}>Confirmer la suppression</button>
                          <button type="button" className="btn btn-link" onClick={() => setDeleting(null)}>Garder</button>
                        </>
                      ) : <button type="button" className="btn btn-link" onClick={() => setDeleting(s.id)}>Supprimer</button>}
                    </div>
                  </>
                )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function History({ specials }: { specials: DailySpecial[] }) {
  if (specials.length === 0) return <p className="empty">Les plats des jours passés apparaîtront ici.</p>
  return (
    <ul className="card-list">
      {specials.map((s) => (
        <li key={s.id} className="card history-card">
          {s.photo ? <img src={s.photo} alt="" className="history-thumb" /> : <span className="history-thumb" aria-hidden="true" />}
          <div>
            <div className="card-head"><h3>{s.name}</h3><span className="muted">{formatDate(s.date)}</span></div>
            <Stats special={s} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function ChefSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const [days] = useState(() => {
    const now = new Date()
    return { today: localDay(now), tomorrow: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) }
  })
  const specials = useApi<DailySpecial[]>('dailySpecials')

  const all = specials.data ?? []
  const todays = all.find((s) => s.date === days.today)
  const planned = all.filter((s) => s.date > days.today).sort((a, b) => a.date.localeCompare(b.date))
  const past = all.filter((s) => s.date < days.today)

  return (
    <main className="desk chef">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Cuisine</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={[
        { id: 'aujourdhui', label: 'Aujourd’hui' },
        { id: 'planning', label: 'Planifiés', count: planned.length },
        { id: 'historique', label: 'Historique' },
      ]} current={tab} onSelect={select} label="Plat du jour">
        {!specials.data ? <Loading failed={specials.failed} />
          : tab === 'aujourdhui' ? <Today special={todays} today={days.today} onChange={specials.reload} />
            : tab === 'planning' ? <Planning specials={planned} tomorrow={days.tomorrow} onChange={specials.reload} />
              : <History specials={past} />}
      </Tabs>
    </main>
  )
}
