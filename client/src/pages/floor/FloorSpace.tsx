import { motion } from 'motion/react'
import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { formatPrice, useApi, type Seance, type Table, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Toast from '../../ui/Toast'
import TablePanel from './TablePanel'
import './floor.css'

const time = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const NOTIFICATIONS: Notifications = {
  // check-ins come from the reservation desk; walk-ins are opened by the waiter themselves (no reservation)
  seance_opened: (p) => (p.reservation ? `Table n°${p.table_number} : ${p.name} vient d’être installé.` : ''),
  seance_closed: (p) => `Table n°${p.table_number} libérée.`,
}

function TableTile({ table, seance, selected, onSelect }: {
  table: Table; seance: Seance | undefined; selected: boolean; onSelect: () => void
}) {
  const state = seance ? 'is-occupied' : table.reserved_at ? 'is-reserved' : 'is-free'
  return (
    <button type="button" className={`table-tile ${state}${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="table-number">{table.number}</span>
      <span className="table-capacity">{table.capacity} pl.</span>
      <span className="table-state">
        {seance ? <>{seance.name}<br />{formatPrice(seance.total_due)}</>
          : table.reserved_at ? `Réservée ${time.format(new Date(table.reserved_at))}` : 'Libre'}
      </span>
    </button>
  )
}

export default function FloorSpace({ user }: { user: User }) {
  const [params, setParams] = useSearchParams()
  const tables = useApi<Table[]>('tables')
  const seances = useApi<Seance[]>('seances', { status: 'OPEN' })

  const { reload: reloadTables } = tables
  const { reload: reloadSeances } = seances
  const refresh = useCallback(() => { reloadTables(); reloadSeances() }, [reloadTables, reloadSeances])
  const { toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  if (!tables.data || !seances.data) {
    return <main className="desk"><Loading failed={tables.failed || seances.failed} /></main>
  }
  const byTable = new Map(seances.data.map((s) => [s.table_number, s]))
  const selectedNumber = Number(params.get('table'))
  const selected = tables.data.find((t) => t.number === selectedNumber)
  const select = (n: number) => setParams(n === selectedNumber ? {} : { table: String(n) }, { replace: true })

  return (
    <main className="desk floor">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Salle</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <div className="floor-layout">
        <div className="floor-plan">
          {(['STANDARD', 'VIP'] as const).map((zone) => (
            <section key={zone} aria-labelledby={`zone-${zone}`}>
              <h2 id={`zone-${zone}`} className="desk-section-title">{zone === 'VIP' ? 'Salon VIP' : 'Salle'}</h2>
              <div className="table-grid">
                {tables.data!.filter((t) => t.zone === zone).map((t) => (
                  <TableTile key={t.id} table={t} seance={byTable.get(t.number)} selected={t.number === selectedNumber}
                    onSelect={() => select(t.number)} />
                ))}
              </div>
            </section>
          ))}
          <p className="floor-legend" aria-hidden="true">
            <span className="dot is-free" /> Libre <span className="dot is-occupied" /> Occupée <span className="dot is-reserved" /> Réservée bientôt
          </p>
        </div>

        {selected
          ? <TablePanel key={selected.number} table={selected} seance={byTable.get(selected.number) ?? null} onChange={refresh} />
          : <p className="empty floor-hint">Choisissez une table pour voir sa séance ou prendre une commande.</p>}
      </div>

      <Toast toast={toast} />
    </main>
  )
}
