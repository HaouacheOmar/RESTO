import { Copy, KeyRound } from 'lucide-react'
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'

import { api, errorText, useApi, type CameraSetup as Camera, type Point, type Table } from '../../api'
import Loading from '../../ui/Loading'
import './monitoring.css'

// the manager's camera page: add cameras (one per zone of the restaurant, or several for a big room), draw on each
// camera's image where its tables are, and the areas that must always stay blurred.

const ICON = { size: 16, strokeWidth: 1.25, 'aria-hidden': true } as const
type Shapes = Record<number, { polygon: Point[]; outline: Point[] }>  // per table number
// what the next clicks draw: a table's counting zone, a table's tabletop, or a privacy mask
type Target = `zone:${number}` | `outline:${number}` | 'mask'

/** the token is shown once: copy it into the worker's settings. */
function TokenCard({ camera, token, onClose }: { camera: string; token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="card cam-token" role="status">
      <div className="card-head"><h3><KeyRound {...ICON} /> Jeton de la caméra « {camera} »</h3></div>
      <p className="muted">Copiez-le maintenant dans les réglages du worker de cette caméra : il ne sera plus jamais affiché.</p>
      <code>RESTO_DEVICE_TOKEN={token}</code>
      <div className="card-actions">
        <button type="button" className="btn btn-ink btn-small"
          onClick={() => navigator.clipboard.writeText(token).then(() => setCopied(true))}>
          <Copy {...ICON} /> {copied ? 'Copié' : 'Copier'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>J’ai copié le jeton</button>
      </div>
    </div>
  )
}

/** the camera image to draw on: a still image from the worker, else the demo clip, else an empty grid. */
function Background({ camera }: { camera: Camera }) {
  const [snapshot, setSnapshot] = useState<string | null>(null)
  useEffect(() => {
    if (!camera.live) return
    api<{ snapshot: string }>('monitoringStream', { id: camera.slug, method: 'POST' })
      .then((r) => setSnapshot(r.snapshot)).catch(() => setSnapshot(null))
  }, [camera.live, camera.slug])
  if (snapshot) return <img src={snapshot} alt="" />
  if (camera.replay_video) return <video src={`${camera.replay_video}#t=0.5`} muted playsInline preload="auto" aria-hidden="true" />
  return <p className="cam-empty">Pas d’image : démarrez le worker de cette caméra pour dessiner sur l’image réelle.</p>
}

const toSvg = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')
const centre = (points: Point[]) => points.reduce<Point>(([x, y], [px, py]) => [x + px / points.length, y + py / points.length], [0, 0])

function ZoneEditor({ camera, tables, takenBy, onSaved, onClose }: {
  camera: Camera; tables: Table[]; takenBy: Map<number, string>; onSaved: () => void; onClose: () => void
}) {
  const [shapes, setShapes] = useState<Shapes>(() =>
    Object.fromEntries(camera.zones.map((z) => [z.table_number, { polygon: z.polygon, outline: z.outline }])))
  const [masks, setMasks] = useState<Point[][]>(camera.privacy_masks)
  const [target, setTarget] = useState<Target>(() => {
    const first = tables.find((t) => !takenBy.has(t.number))
    return first ? `zone:${first.number}` : 'mask'
  })
  const [draft, setDraft] = useState<Point[]>([])
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)

  // one click = one corner, in fractions of the image (so it works whatever the camera's resolution)
  function addPoint(event: MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
    setDraft((d) => [...d, [round((event.clientX - box.left) / box.width), round((event.clientY - box.top) / box.height)]])
  }

  function finish() {
    if (target === 'mask') setMasks((m) => [...m, draft])
    else {
      const [kind, number] = target.split(':') as ['zone' | 'outline', string]
      setShapes((s) => {
        const table = s[+number] ?? { polygon: [], outline: [] }
        return { ...s, [number]: { ...table, [kind === 'zone' ? 'polygon' : 'outline']: draft } }
      })
    }
    setDraft([])
  }

  function removeTable(number: number) {
    setShapes(({ [number]: _removed, ...rest }) => rest)
  }

  async function save() {
    const drawn = Object.entries(shapes).map(([number, s]) => ({ table_number: +number, ...s }))
    const incomplete = drawn.find((z) => z.polygon.length < 3)
    if (incomplete) {
      setMessage({ error: true, text: `Table n°${incomplete.table_number} : tracez aussi sa zone de comptage (la table et ses chaises).` })
      return
    }
    try {
      await api('cameraSetup', { id: camera.slug, method: 'PATCH', body: { zones: drawn, privacy_masks: masks } })
      setMessage({ error: false, text: 'Enregistré. Le worker applique les nouvelles zones dans la minute, sans redémarrer.' })
      onSaved()
    } catch (e) {
      setMessage({ error: true, text: errorText(e, 'Enregistrement impossible.') })
    }
  }

  const drawable = tables.filter((t) => takenBy.get(t.number) === undefined)
  return (
    <section className="cam-editor" aria-labelledby="cam-editor-title">
      <div className="card-head">
        <h2 id="cam-editor-title" className="desk-section-title">Zones de « {camera.name} »</h2>
        <button type="button" className="btn btn-link" onClick={onClose}>Fermer</button>
      </div>
      <div className="cam-layout">
        <div className="cam-canvas">
          <Background camera={camera} />
          {/* the drawing: viewBox 0..1 = the same fractions the worker uses */}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" onClick={addPoint} role="img"
            aria-label="Image de la caméra : cliquez pour placer les coins de la forme">
            {masks.map((m, i) => <polygon key={`m${i}`} points={toSvg(m)} className="cam-mask" />)}
            {Object.entries(shapes).map(([n, s]) => (
              <g key={n}>
                {s.polygon.length > 2 && <polygon points={toSvg(s.polygon)} className="cam-zone" />}
                {s.outline.length > 2 && <polygon points={toSvg(s.outline)} className="cam-outline" />}
              </g>
            ))}
            {draft.length > 0 && <polyline points={toSvg(draft)} className="cam-draft" />}
          </svg>
          {/* labels and corners in html: the svg is stretched, round dots and text would be distorted */}
          {Object.entries(shapes).map(([n, s]) => {
            const [x, y] = centre(s.outline.length > 2 ? s.outline : s.polygon)
            return s.polygon.length > 2 && <span key={n} className="cam-label" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>T{n}</span>
          })}
          {draft.map(([x, y], i) => <span key={i} className="cam-dot" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />)}
        </div>

        <div className="cam-tools">
          <label className="field">
            <span>Tracer</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value as Target); setDraft([]) }}>
              {drawable.map((t) => [
                <option key={`z${t.number}`} value={`zone:${t.number}`}>Table n°{t.number} : zone de comptage</option>,
                <option key={`o${t.number}`} value={`outline:${t.number}`}>Table n°{t.number} : plateau (dessin)</option>,
              ])}
              <option value="mask">Masque de confidentialité</option>
            </select>
          </label>
          <p className="field-hint">
            Cliquez les coins dans l’ordre, puis validez. La zone de comptage entoure la table et ses chaises ;
            le plateau sert seulement au dessin sur la vidéo ; un masque floute toujours une zone (vitrine, entrée).
          </p>
          <div className="card-actions">
            <button type="button" className="btn btn-ink btn-small" disabled={draft.length < 3} onClick={finish}>Valider la forme</button>
            <button type="button" className="btn btn-link" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>Annuler le dernier point</button>
          </div>

          <ul className="cam-shapes">
            {Object.entries(shapes).map(([n, s]) => (
              <li key={n}>
                Table n°{n} <span className="muted">· zone {s.polygon.length > 2 ? '✓' : '—'} · plateau {s.outline.length > 2 ? '✓' : '—'}</span>
                <button type="button" className="btn btn-link" onClick={() => removeTable(+n)}>Retirer</button>
              </li>
            ))}
            {masks.map((_, i) => (
              <li key={`m${i}`}>
                Masque {i + 1}
                <button type="button" className="btn btn-link" onClick={() => setMasks((m) => m.filter((_, j) => j !== i))}>Retirer</button>
              </li>
            ))}
          </ul>
          {takenBy.size > 0 && (
            <p className="field-hint">Une table ne peut être suivie que par une caméra (personne n’est compté deux fois) : celles des autres caméras n’apparaissent pas ici.</p>
          )}
          {message && <p className={message.error ? 'form-error' : 'muted'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
          <button type="button" className="btn btn-ink" onClick={save}>Enregistrer les zones</button>
        </div>
      </div>
    </section>
  )
}

export default function CameraSetup() {
  const cameras = useApi<Camera[]>('cameraSetups')
  const tables = useApi<Table[]>('tables')
  const [editing, setEditing] = useState<string | null>(null)
  const [token, setToken] = useState<{ camera: string; token: string } | null>(null)
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError('')
    try {
      await action()
      cameras.reload()
      return true
    } catch (e) {
      setError(errorText(e, fallback))
      return false
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form))
    await run(async () => {
      const camera = await api<Camera>('cameraSetups', { method: 'POST', body })
      setToken({ camera: camera.name, token: camera.token! })
      form.reset()
    }, 'Ajout impossible.')
  }

  const newToken = (camera: Camera) => window.confirm(`Créer un nouveau jeton pour « ${camera.name} » ? L’ancien cessera de marcher tout de suite.`)
    && run(async () => setToken({ camera: camera.name, ...(await api<{ token: string }>('cameraToken', { id: camera.slug, method: 'POST' })) }),
      'Jeton impossible à créer.')

  if (!cameras.data || !tables.data) return <Loading failed={cameras.failed || tables.failed} />
  const current = cameras.data.find((c) => c.slug === editing)
  // which camera already watches each table
  const watcher = new Map(cameras.data.flatMap((c) => c.zones.map((z) => [z.table_number, c] as const)))
  return (
    <div className="cam-setup">
      <section aria-labelledby="cameras-title">
        <h2 id="cameras-title" className="desk-section-title">Caméras</h2>
        <p className="muted">
          Une caméra par zone du restaurant (salle VIP, salle front de mer, terrasse…), ou plusieurs pour couvrir une grande salle. Chaque caméra a son propre worker sur place,
          qui lit la caméra et n’envoie que des nombres et une vidéo floutée.
        </p>
        <form className="inline-form" onSubmit={add} aria-label="Ajouter une caméra">
          <label>Nom <input name="name" required placeholder="Caméra VIP" /></label>
          <label>Identifiant <input name="slug" required pattern="[a-z0-9\-]+" placeholder="vip" title="Minuscules, chiffres et tirets" /></label>
          <label>Zone <input name="area" placeholder="Salle VIP" /></label>
          <button type="submit" className="btn btn-ink btn-small">Ajouter</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        {token && <TokenCard {...token} onClose={() => setToken(null)} />}

        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th scope="col">Caméra</th><th scope="col">Zone</th><th scope="col">Tables</th><th scope="col">État</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {cameras.data.map((c) => (
                <tr key={c.slug}>
                  <td>{c.name} <span className="muted">· {c.slug}</span></td>
                  <td>{c.area || '—'}</td>
                  <td>{c.zones.length ? c.zones.map((z) => `n°${z.table_number}`).join(', ') : <span className="muted">aucune</span>}</td>
                  <td>
                    <span className={`badge ${c.online ? 'is-confirmed' : ''}`}>
                      {!c.is_active ? 'Désactivée' : c.online ? 'En ligne' : 'Hors ligne'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-link" onClick={() => setEditing(c.slug)}>Dessiner les zones</button>
                    <button type="button" className="btn btn-link" onClick={() => {
                      const area = window.prompt(`Zone couverte par « ${c.name} » (ex. Salle VIP, Salle front de mer) :`, c.area)
                      if (area !== null) run(() => api('cameraSetup', { id: c.slug, method: 'PATCH', body: { area: area.trim() } }), 'Modification impossible.')
                    }}>Changer la zone</button>
                    <button type="button" className="btn btn-link" onClick={() => newToken(c)}>Nouveau jeton</button>
                    <button type="button" className="btn btn-link"
                      onClick={() => run(() => api('cameraSetup', { id: c.slug, method: 'PATCH', body: { is_active: !c.is_active } }), 'Modification impossible.')}>
                      {c.is_active ? 'Désactiver' : 'Activer'}
                    </button>
                    <button type="button" className="btn btn-link"
                      onClick={() => window.confirm(`Supprimer la caméra « ${c.name} » et ses zones ?`)
                        && run(() => api('cameraSetup', { id: c.slug, method: 'DELETE' }), 'Suppression impossible.')}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
              {cameras.data.length === 0 && <tr><td colSpan={5} className="muted">Aucune caméra pour l’instant.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {current && (
        <ZoneEditor key={current.slug} camera={current} tables={tables.data} onSaved={cameras.reload}
          onClose={() => setEditing(null)}
          takenBy={new Map([...watcher].filter(([, c]) => c.slug !== current.slug).map(([n, c]) => [n, c.name]))} />
      )}
    </div>
  )
}
