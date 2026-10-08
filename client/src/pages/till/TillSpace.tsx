import { motion } from 'motion/react'
import { Banknote, CreditCard } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api, formatPrice, toErrors, useApi, type Addition, type Seance, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import ReceiptDialog from './Receipt'
import './till.css'

const TAB_IDS = ['a-encaisser', 'encaissements'] as const
const time = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const NOTIFICATIONS: Notifications = {
  order_created: (p) => (p.table ? `Nouvelle commande, table n°${p.table}.` : ''),
  order_cancelled: (p) => (p.table ? `Commande annulée, table n°${p.table}.` : ''),
}

function SeanceCard({ seance, onPaid }: { seance: Seance; onPaid: (additionId: number) => void }) {
  const [method, setMethod] = useState<'CASH' | 'CARD' | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const orders = seance.orders.filter((o) => o.status === 'PENDING')
  const due = Number(seance.total_due)

  async function pay() {
    setPending(true)
    setError('')
    try {
      const addition = await api<Addition>('seancePay', { id: seance.id, method: 'POST', body: { method } })
      onPaid(addition.id)
    } catch (e) {
      const errors = toErrors(e, 'Encaissement impossible.')
      setError(errors.form ?? Object.values(errors)[0])
      setPending(false)
    }
  }

  return (
    <li className="card till-card">
      <div className="card-head">
        <h3>Table n°{seance.table_number}</h3>
        <strong className="till-due">{formatPrice(seance.total_due)}</strong>
      </div>
      <p className="muted">{seance.name} · depuis {time.format(new Date(seance.opened_at))}</p>
      {orders.length === 0 ? <p className="muted">Pas encore de commande.</p> : (
        <ul className="till-lines">
          {orders.flatMap((o) => o.items.map((i, n) => (
            <li key={`${o.id}-${n}`}><span>{i.quantity} × {i.name}</span><span>{formatPrice(String(Number(i.unit_price) * i.quantity))}</span></li>
          )))}
        </ul>
      )}
      {due > 0 && (method === null ? (
        <div className="card-actions">
          <button type="button" className="btn btn-ink btn-small" onClick={() => setMethod('CASH')}>Encaisser</button>
        </div>
      ) : (
        <div className="pay-panel">
          <fieldset className="pay-methods">
            <legend>Moyen de paiement</legend>
            {([['CASH', 'Espèces', Banknote], ['CARD', 'Carte', CreditCard]] as const).map(([value, label, Icon]) => (
              <label key={value} className={method === value ? 'is-selected' : ''}>
                <input type="radio" name={`method-${seance.id}`} checked={method === value} onChange={() => setMethod(value)} />
                <Icon aria-hidden="true" size={20} strokeWidth={1.5} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="card-actions">
            <button type="button" className="btn btn-ink btn-small" disabled={pending} onClick={pay}>
              {pending ? 'Encaissement…' : `Encaisser ${formatPrice(seance.total_due)}`}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setMethod(null)}>Annuler</button>
          </div>
        </div>
      ))}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  )
}

function DayTakings({ additions, onReprint }: { additions: Addition[]; onReprint: (id: number) => void }) {
  if (additions.length === 0) return <p className="empty">Aucun encaissement aujourd’hui.</p>
  const sum = (method: Addition['method']) =>
    additions.filter((a) => a.method === method).reduce((total, a) => total + Number(a.amount), 0)
  return (
    <>
      <dl className="takings">
        <div><dt>Total du jour</dt><dd>{formatPrice(String(sum('CASH') + sum('CARD')))}</dd></div>
        <div><dt>Espèces</dt><dd>{formatPrice(String(sum('CASH')))}</dd></div>
        <div><dt>Carte</dt><dd>{formatPrice(String(sum('CARD')))}</dd></div>
      </dl>
      <ul className="card-list">
        {additions.map((a) => (
          <li key={a.id} className="card till-history">
            <span>{time.format(new Date(a.created_at))}</span>
            <span>{a.table_number !== null ? `Table n°${a.table_number}` : 'Livraison'}</span>
            <span>{a.method === 'CARD' ? 'Carte' : 'Espèces'}</span>
            <strong>{formatPrice(a.amount)}</strong>
            <button type="button" className="btn btn-link" onClick={() => onReprint(a.id)}>Ticket</button>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function TillSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const [receipt, setReceipt] = useState<number | null>(null)
  const [today] = useState(() => localDay(new Date()))
  const seances = useApi<Seance[]>('seances', { status: 'OPEN' })
  const additions = useApi<Addition[]>('additions', { date: today })

  const { reload: reloadSeances } = seances
  const { reload: reloadAdditions } = additions
  const refresh = useCallback(() => { reloadSeances(); reloadAdditions() }, [reloadSeances, reloadAdditions])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  const toCollect = (seances.data ?? []).filter((s) => Number(s.total_due) > 0)
  const waiting = (seances.data ?? []).filter((s) => Number(s.total_due) === 0)

  return (
    <main className="desk">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Caisse</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={[
        { id: 'a-encaisser', label: 'À encaisser', count: toCollect.length },
        { id: 'encaissements', label: 'Encaissements du jour' },
      ]} current={tab} onSelect={select} label="Caisse">
        {tab === 'a-encaisser' ? (!seances.data ? <Loading failed={seances.failed} /> : (
          <>
            {toCollect.length === 0 ? <p className="empty">Aucune table à encaisser.</p> : (
              <ul className="till-grid">
                {toCollect.map((s) => (
                  <SeanceCard key={s.id} seance={s} onPaid={(id) => { refresh(); setReceipt(id) }} />
                ))}
              </ul>
            )}
            {waiting.length > 0 && (
              <p className="muted till-waiting">
                Tables installées sans commande : {waiting.map((s) => `n°${s.table_number}`).join(', ')}.
              </p>
            )}
          </>
        )) : (!additions.data ? <Loading failed={additions.failed} />
          : <DayTakings additions={additions.data} onReprint={setReceipt} />)}
      </Tabs>

      {receipt !== null && <ReceiptDialog additionId={receipt} onClose={() => setReceipt(null)} />}
      <Toast toast={toast} />
    </main>
  )
}
