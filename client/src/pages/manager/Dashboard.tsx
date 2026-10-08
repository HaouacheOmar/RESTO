import { Radio, Star } from 'lucide-react'

import { formatPrice, type Dashboard as Stats } from '../../api'
import type { LiveEvent, LiveStatus } from '../../realtime'
import { BarList, ColumnChart, type Point } from './Charts'

const DAYS = 14
const day = new Intl.DateTimeFormat('fr-DZ', { day: 'numeric', month: 'short' })
const clock = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const money = (n: number) => formatPrice(String(n))
const score = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1).replace('.', ','))

/** Business events worth a line in the manager's feed, in plain French. */
const FEED: Record<string, (p: Record<string, unknown>) => string> = {
  addition_paid: (p) => `Addition encaissée : ${formatPrice(String(p.amount))}`,
  review_created: (p) => `Nouvel avis : ${p.rating}/5`,
  stock_request_created: (p) => `Demande de réapprovisionnement : ${p.ingredient_name}`,
  rupture_started: (p) => `Rupture : ${p.name}`,
  rupture_ended: (p) => `Fin de rupture : ${p.name}`,
  delivery_failed: (p) => `Livraison échouée (commande n°${p.id})`,
  reservation_created: (p) => `Nouvelle réservation (${p.guest_count} pers.)`,
  order_created: (p) => (p.is_delivery ? 'Nouvelle livraison' : `Nouvelle commande, table n°${p.table}`),
}

/** Last DAYS days, oldest first, with a zero for days without sales (gaps are information too). */
function revenuePoints(stats: Stats, today: Date): Point[] {
  const byDay = new Map(stats.revenue_by_day.map((d) => [d.day, d]))
  return Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1 - i))
    const row = byDay.get(ymd(d))
    return {
      key: ymd(d), label: day.format(d), value: Number(row?.total ?? 0),
      detail: `${row?.additions ?? 0} addition${(row?.additions ?? 0) > 1 ? 's' : ''}`,
    }
  })
}

export default function Dashboard({ stats, today, status, events }: {
  stats: Stats; today: Date; status: LiveStatus; events: LiveEvent[]
}) {
  const points = revenuePoints(stats, today)
  const todayTotal = points[points.length - 1].value
  const feed = events.filter((e) => FEED[e.event]).slice(0, 12)
  const staffName = (s: Stats['staff_ratings'][number]) => [s.staff__first_name, s.staff__last_name].join(' ').trim() || s.staff__username

  return (
    <div className="dashboard">
      <section className="kpis" aria-label="Chiffres clés">
        <div className="hero-figure">
          <p className="kpi-label">Chiffre d’affaires aujourd’hui</p>
          <p className="hero-value">{money(todayTotal)}</p>
          <p className="kpi-sub">{points[points.length - 1].detail} · total depuis l’ouverture {money(Number(stats.revenue_total))}</p>
        </div>
        <div className="stat-tile"><p className="kpi-label">Note du restaurant</p>
          <p className="kpi-value">{score(stats.restaurant_rating.average)}<span className="kpi-unit"> / 5</span></p>
          <p className="kpi-sub">{stats.restaurant_rating.count} avis</p></div>
        <div className="stat-tile"><p className="kpi-label">No-shows</p><p className="kpi-value">{stats.no_shows}</p></div>
        <div className="stat-tile"><p className="kpi-label">Livraisons échouées</p><p className="kpi-value">{stats.failed_deliveries}</p></div>
        <div className={`stat-tile${stats.ruptures.length ? ' is-alert' : ''}`}>
          <p className="kpi-label">Ruptures</p><p className="kpi-value">{stats.ruptures.length}</p>
          <p className="kpi-sub">{stats.ruptures.map((r) => r.name).join(', ') || 'Aucune'}</p></div>
        <div className="stat-tile"><p className="kpi-label">Demandes de stock en attente</p><p className="kpi-value">{stats.pending_stock_requests}</p></div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <ColumnChart title={`Chiffre d’affaires, ${DAYS} derniers jours`} points={points} format={money} />
        </section>
        <section className="panel">
          <BarList title="Les plus vendus" rows={stats.top_items.map((t) => ({ label: t.item, value: t.sold }))} unit="vendus" />
        </section>

        <section className="panel" aria-labelledby="ratings-title">
          <h2 id="ratings-title" className="chart-title">Notes</h2>
          <table className="ratings">
            <thead><tr><th scope="col">Personnel</th><th scope="col">Note</th><th scope="col">Avis</th></tr></thead>
            <tbody>
              {stats.staff_ratings.length === 0 && <tr><td colSpan={3} className="muted">Pas encore d’avis sur l’équipe.</td></tr>}
              {stats.staff_ratings.map((s) => (
                <tr key={s.staff}><td>{staffName(s)} <span className="muted">· {s.staff__role === 'SERVER' ? 'serveur' : 'livreur'}</span></td>
                  <td><Star aria-hidden="true" size={14} className="star-on" /> {score(s.average)}</td><td>{s.count}</td></tr>
              ))}
            </tbody>
            <thead><tr><th scope="col">Plats et plats du jour</th><th scope="col">Note</th><th scope="col">Avis</th></tr></thead>
            <tbody>
              {stats.dish_ratings.length + stats.daily_special_ratings.length === 0 && <tr><td colSpan={3} className="muted">Pas encore d’avis sur les plats.</td></tr>}
              {stats.dish_ratings.map((d) => (
                <tr key={`d${d.dish}`}><td>{d.dish__name}</td><td><Star aria-hidden="true" size={14} className="star-on" /> {score(d.average)}</td><td>{d.count}</td></tr>
              ))}
              {stats.daily_special_ratings.map((d) => (
                <tr key={`s${d.daily_special}`}><td>{d.daily_special__name} <span className="muted">· plat du jour</span></td>
                  <td><Star aria-hidden="true" size={14} className="star-on" /> {score(d.average)}</td><td>{d.count}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-labelledby="feed-title">
          <div className="live-head">
            <h2 id="feed-title" className="chart-title">En direct</h2>
            <span className={`live-status is-${status}`} role="status"><Radio aria-hidden="true" size={14} /> {status === 'open' ? 'Connecté' : 'Reconnexion…'}</span>
          </div>
          {feed.length === 0 ? <p className="muted">Encaissements, avis, ruptures et livraisons s’afficheront ici.</p> : (
            <ol className="feed" aria-live="polite">
              {feed.map((e) => <li key={e.id}><time>{clock.format(e.receivedAt)}</time> {FEED[e.event](e.payload)}</li>)}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
