import { useId } from 'react'

/** Clean axis maximum: 1, 2, 2.5 or 5 × 10^n, so tick labels stay round. */
function niceMax(value: number) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value)!
  return step * power
}

const compact = new Intl.NumberFormat('fr-DZ', { notation: 'compact', maximumFractionDigits: 1 })

export interface Point { key: string; label: string; value: number; detail: string }

/**
 * Single-series column chart (one hue, no legend: the title names the series). Each column is focusable and
 * shows a tooltip on hover/focus; the extreme is labelled on its cap; a table view carries every value.
 */
export function ColumnChart({ title, points, format }: { title: string; points: Point[]; format: (n: number) => string }) {
  const id = useId()
  const max = niceMax(Math.max(...points.map((p) => p.value)))
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0])
  const ticks = [max, max / 2, 0]
  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="chart-title">{title}</figcaption>
      <div className="column-chart">
        <div className="chart-axis" aria-hidden="true">{ticks.map((t) => <span key={t}>{compact.format(t)}</span>)}</div>
        <div className="chart-plot">
          {ticks.map((t) => (
            // inside the bar area only: the bottom 1.4rem of the plot holds the day labels
            <span key={t} className="gridline" style={{ bottom: `calc(1.4rem + (100% - 1.4rem) * ${t / max})` }} aria-hidden="true" />
          ))}
          {points.map((p) => (
            <div key={p.key} className="column-slot">
              <div className="column" tabIndex={0} role="img" aria-label={`${p.label} : ${format(p.value)}, ${p.detail}`}
                style={{ height: `${Math.max((p.value / max) * 100, p.value ? 1 : 0)}%` }}>
                {p === peak && p.value > 0 && <span className="column-cap">{compact.format(p.value)}</span>}
                <span className="chart-tooltip" role="presentation"><strong>{format(p.value)}</strong>{p.label}<br />{p.detail}</span>
              </div>
              <span className="column-label" aria-hidden="true">{p.label}</span>
            </div>
          ))}
        </div>
      </div>
      <details className="chart-table">
        <summary>Voir le tableau</summary>
        <table>
          <thead><tr><th scope="col">Jour</th><th scope="col">Montant</th><th scope="col">Détail</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.key}><td>{p.label}</td><td>{format(p.value)}</td><td>{p.detail}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars for a ranked list (best sellers): label left, bar, value at the tip. */
export function BarList({ title, rows, unit }: { title: string; rows: { label: string; value: number }[]; unit: string }) {
  const id = useId()
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="chart-title">{title}</figcaption>
      {rows.length === 0 ? <p className="muted">Pas encore de ventes.</p> : (
        <ol className="bar-list">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track"><span className="bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
              <span className="bar-value">{r.value} {unit}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  )
}
