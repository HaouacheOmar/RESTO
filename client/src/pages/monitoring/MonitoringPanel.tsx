import { Eye, Radio, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  api, useApi, type CameraReading, type MonitoredTable, type MonitoringCamera, type MonitoringTimeline,
} from '../../api'
import { useLiveRefresh } from '../../realtime'
import Loading from '../../ui/Loading'
import './monitoring.css'

// the colour of a table. the core (séance, reservation) always decides first; the camera only adds to it.
type TableStatus = 'occupied' | 'reserved' | 'arrived' | 'unserved' | 'free'

function statusOf(table: MonitoredTable, camera: CameraReading | null): TableStatus {
  if (table.is_occupied) return 'occupied'  // an open séance: guests are being served
  if (table.reserved_at) return camera?.occupied ? 'arrived' : 'reserved'  // reserved stays reserved
  if (camera?.occupied) return 'unserved'  // people seated but no séance: someone should serve them
  return 'free'
}

const LABELS: Record<TableStatus, string> = {
  occupied: 'Occupée', reserved: 'Réservée', arrived: 'Clients arrivés ?',
  unserved: 'Sans séance', free: 'Libre',
}
// badge colours from the design system: success for free, danger when someone must act, neutral cream otherwise
const BADGES: Record<TableStatus, string> = {
  free: 'is-confirmed', unserved: 'is-failed', occupied: '', reserved: '', arrived: '',
}
const ICON = { size: 16, strokeWidth: 1.25, 'aria-hidden': true } as const  // lucide icons: thin, decorative
const time = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit' })
const REFRESH_EVERY = 15_000  // séances opened by the waiters are not pushed to the desk: we also poll

/** the camera reading of each table at a moment of the demo clip (the last change before that time). */
function readingsAt(timeline: MonitoringTimeline, seconds: number) {
  let current = timeline.events[0]
  for (const event of timeline.events) {
    if (event.t > seconds) break
    current = event
  }
  return new Map((current?.tables ?? []).map((t) => [t.table_number, { people: t.people, occupied: t.occupied }]))
}

/** the camera picture: the live blurred stream if a worker runs, otherwise the demo clip blurred in advance. */
function CameraView({ camera, onReplayReadings }: {
  camera: MonitoringCamera; onReplayReadings: (readings: Map<number, CameraReading> | null) => void
}) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<MonitoringTimeline | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  // live: ask the api for a signed url (valid 60 s); ask again if the stream breaks
  const openStream = useCallback(() => {
    api<{ url: string }>('monitoringStream', { id: camera.slug, method: 'POST' })
      .then(({ url }) => setStreamUrl(url)).catch(() => setStreamUrl(null))
  }, [camera.slug])
  useEffect(() => { if (camera.live) openStream() }, [camera.live, openStream])

  // demo: load the recorded readings (a static file next to the clip)
  useEffect(() => {
    if (camera.live || !camera.replay_timeline) return
    fetch(camera.replay_timeline).then((r) => r.json()).then(setTimeline).catch(() => setTimeline(null))
    return () => onReplayReadings(null)
  }, [camera.live, camera.replay_timeline, onReplayReadings])

  if (camera.live) {
    return (
      <figure className="cctv">
        {streamUrl
          ? <img src={streamUrl} alt={`Caméra ${camera.name}, personnes floutées`} onError={() => setTimeout(openStream, 5000)} />
          : <p className="cctv-empty">Connexion à la caméra…</p>}
        <figcaption><span className="cctv-badge is-live"><Radio {...ICON} /> En direct</span> {camera.name}</figcaption>
      </figure>
    )
  }
  if (!camera.replay_video) return <p className="cctv-empty">Caméra hors ligne.</p>
  return (
    <figure className="cctv">
      <video ref={video} src={camera.replay_video} autoPlay muted loop playsInline
        aria-label={`Caméra ${camera.name}, séquence de démonstration floutée`}
        // the clip plays by itself; every time its position moves, we replay the readings recorded at that moment
        onTimeUpdate={() => timeline && video.current && onReplayReadings(readingsAt(timeline, video.current.currentTime))} />
      <figcaption><span className="cctv-badge">Démo</span> {camera.name} · séquence enregistrée et floutée à l’avance</figcaption>
    </figure>
  )
}

/** one table drawn from above: its chairs, filled with the people the camera counts. */
function TableDrawing({ table, camera, cameraName }: {
  table: MonitoredTable; camera: CameraReading | null; cameraName?: string
}) {
  const status = statusOf(table, camera)
  const people = camera ? Math.min(camera.people, table.capacity) : 0
  const top = Math.ceil(table.capacity / 2)  // chairs above the table, the rest below
  const chairs = Array.from({ length: table.capacity }, (_, i) => i < people)
  const detail = status === 'occupied' ? table.seance_name
    : table.reserved_at ? `Réservée pour ${time.format(new Date(table.reserved_at))}` : null
  return (
    <li className={`card mt-table is-${status}`}>
      <div className="card-head">
        <h3>Table n°{table.number}</h3>
        <span className={`badge ${BADGES[status]}`}>{LABELS[status]}</span>
      </div>
      {/* the table seen from above: one dot per chair, filled for each person the camera counts */}
      <div className="mt-drawing" aria-hidden="true">
        <div className="mt-chairs">{chairs.slice(0, top).map((filled, i) => <span key={i} className={filled ? 'is-taken' : ''} />)}</div>
        <div className="mt-top">{table.number}</div>
        <div className="mt-chairs">{chairs.slice(top).map((filled, i) => <span key={i} className={filled ? 'is-taken' : ''} />)}</div>
      </div>
      {detail && <p className="muted">{detail}</p>}
      <p className="mt-count">
        {table.watched
          ? (camera ? <><strong>{camera.people}</strong> / {table.capacity} personnes</> : <>caméra indisponible · {table.capacity} places</>)
          : <>hors champ · {table.capacity} places</>}
      </p>
      {cameraName && <p className="mt-camera">{cameraName}</p>}
    </li>
  )
}

/** a row of toggle buttons (zones, cameras). shown only when there is a choice to make. */
function Choices<T extends string>({ label, options, current, onSelect }: {
  label: string; options: { id: T; label: string }[]; current: T; onSelect: (id: T) => void
}) {
  if (options.length < 2) return null
  return (
    <div className="mt-filters" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === current} onClick={() => onSelect(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

const ALL = ''  // "every zone"
const areaOf = (camera: { area: string }) => camera.area || 'Salle'

export default function MonitoringPanel() {
  const tables = useApi<MonitoredTable[]>('monitoringTables')
  const cameras = useApi<MonitoringCamera[]>('monitoringCameras')
  const [replay, setReplay] = useState<Map<number, CameraReading> | null>(null)
  // a restaurant can have several zones (salle vip, front de mer...), and several cameras per zone: pick one, then a camera
  const [area, setArea] = useState(ALL)
  const [cameraSlug, setCameraSlug] = useState('')
  const { reload: reloadTables } = tables

  // the worker's readings arrive live ("monitoring_update"); the core's changes are polled as well
  useLiveRefresh(reloadTables, {})
  useEffect(() => {
    const timer = setInterval(reloadTables, REFRESH_EVERY)
    return () => clearInterval(timer)
  }, [reloadTables])

  const inArea = useMemo(() => (cameras.data ?? []).filter((c) => area === ALL || areaOf(c) === area), [cameras.data, area])
  const camera = inArea.find((c) => c.slug === cameraSlug) ?? inArea[0]
  // the demo clip's readings only belong to the tables of the camera that is playing it
  const readingOf = useMemo(() => (t: MonitoredTable) =>
    (t.camera_slug === camera?.slug && replay?.has(t.number) ? replay.get(t.number)! : t.camera), [replay, camera?.slug])

  if (!tables.data || !cameras.data) return <Loading failed={tables.failed || cameras.failed} />
  const areas = [...new Set(cameras.data.map(areaOf))]
  const names = new Map(cameras.data.map((c) => [c.slug, c.name]))
  // in one zone, only the tables its cameras can see (a table belongs to a zone through its camera)
  const shown = area === ALL ? tables.data : tables.data.filter((t) => inArea.some((c) => c.slug === t.camera_slug))
  const zones = [['STANDARD', 'Salle'], ['VIP', 'Salon VIP']] as const
  return (
    <section className="monitoring" aria-label="Surveillance des tables">
      <div className="monitoring-camera">
        <Choices label="Zone" current={area} onSelect={setArea}
          options={areas.length > 1 ? [{ id: ALL, label: 'Toutes les zones' }, ...areas.map((a) => ({ id: a, label: a }))] : []} />
        <Choices label="Caméra" current={camera?.slug ?? ''} onSelect={setCameraSlug}
          options={inArea.map((c) => ({ id: c.slug, label: c.name }))} />
        {/* key: another camera is a new player (its own stream ticket or demo clip) */}
        {camera ? <CameraView key={camera.slug} camera={camera} onReplayReadings={setReplay} /> : <p className="cctv-empty">Aucune caméra configurée.</p>}
        <p className="privacy-note"><ShieldCheck {...ICON} /> Les personnes sont floutées à la source, sur la caméra : aucune image n’est enregistrée, seul le nombre de personnes par table est transmis.</p>
      </div>
      <div className="monitoring-map">
        <ul className="mt-legend" aria-label="Légende">
          {(['free', 'reserved', 'arrived', 'occupied', 'unserved'] as const).map((s) => <li key={s} className={`is-${s}`}>{LABELS[s]}</li>)}
        </ul>
        {zones.map(([zone, title]) => {
          const list = shown.filter((t) => t.zone === zone)
          return list.length > 0 && (
            <section key={zone} aria-labelledby={`mt-${zone}`}>
              <h3 id={`mt-${zone}`} className="desk-section-title"><Eye {...ICON} /> {title}</h3>
              <ul className="mt-grid">{list.map((t) => (
                <TableDrawing key={t.number} table={t} camera={readingOf(t)}
                  cameraName={names.size > 1 && t.camera_slug ? names.get(t.camera_slug) : undefined} />
              ))}</ul>
            </section>
          )
        })}
        {shown.length === 0 && <p className="muted">Aucune table dans le champ des caméras de cette zone.</p>}
      </div>
    </section>
  )
}
