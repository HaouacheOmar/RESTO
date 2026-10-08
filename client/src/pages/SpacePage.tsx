import { AnimatePresence, motion } from 'motion/react'
import { LogOut, Radio } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'

import type { Role, User } from '../api'
import { canOpen, homeOf, roleOfSlug, SPACES } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import { rise, stagger } from '../motion'
import { useRealtime, type LiveStatus } from '../realtime'
import ClientSpace from './client/ClientSpace'
import DeskSpace from './desk/DeskSpace'
import FloorSpace from './floor/FloorSpace'
import ParkingSpace from './parking/ParkingSpace'
import TillSpace from './till/TillSpace'
import './space.css'

/** Spaces already built; the other roles see the placeholder until their ticket lands. */
const CONTENT: Partial<Record<Role, ComponentType<{ user: User }>>> = {
  CLIENT: ClientSpace,
  RESERVATION_MANAGER: DeskSpace,
  PARKING_ATTENDANT: ParkingSpace,
  SERVER: FloorSpace,
  CASHIER: TillSpace,
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  connecting: 'Connexion au direct…',
  open: 'En direct',
  offline: 'Hors ligne',
}

const time = new Intl.DateTimeFormat('fr-DZ', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** Sends anonymous visitors to the login page, remembering where they wanted to go. */
export function RequireAuth({ children }: { children: (user: User) => ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <p className="page-loading" role="status">Chargement…</p>
  if (state.status === 'anonymous') return <Navigate to="/connexion" state={{ from: location.pathname }} replace />
  return <>{children(state.user)}</>
}

export function SpaceHome() {
  return <RequireAuth>{(user) => <Navigate to={homeOf(user)} replace />}</RequireAuth>
}

export function SpacePage() {
  const { slug } = useParams()
  const role = roleOfSlug(slug)
  return (
    <RequireAuth>
      {(user) => (!role || !canOpen(user, role)
        ? <Navigate to={homeOf(user)} replace />
        : <Space role={role} />)}
    </RequireAuth>
  )
}

function Space({ role }: { role: Role }) {
  const { state, logout } = useAuth()
  if (state.status !== 'authenticated') return null
  const Content = CONTENT[role]
  return (
    <div className="space">
      <header className="space-header on-dark">
        <div className="space-header-inner">
          <Link to="/" className="logo">RESTO</Link>
          <span className="space-role">{SPACES[role].title}</span>
          <button type="button" className="space-logout" onClick={logout}>
            <LogOut aria-hidden="true" size={16} /> <span className="logout-label">Déconnexion</span>
          </button>
        </div>
      </header>
      {Content ? <Content user={state.user} /> : <Placeholder user={state.user} role={role} />}
    </div>
  )
}

function Placeholder({ user, role }: { user: User; role: Role }) {
  const { status, events } = useRealtime(true)
  const { title, upcoming } = SPACES[role]
  return (
    <main className="space-main">
      <motion.section className="space-intro" variants={stagger(0.08)} initial="hidden" animate="show">
        <motion.p variants={rise} className="eyebrow">{title}</motion.p>
        <motion.h1 variants={rise}>Bonjour {user.first_name || user.username}.</motion.h1>
        <motion.p variants={rise} className="space-lead">Votre espace se construit : voici ce qu’il vous permettra de faire.</motion.p>
        <motion.ul variants={rise} className="space-upcoming">
          {upcoming.map((item) => <li key={item}>{item}</li>)}
        </motion.ul>
      </motion.section>

      <section className="live" aria-labelledby="live-title">
        <div className="live-head">
          <h2 id="live-title">Activité en direct</h2>
          <span className={`live-status is-${status}`} role="status">
            <Radio aria-hidden="true" size={14} /> {STATUS_LABEL[status]}
          </span>
        </div>
        {events.length === 0 ? (
          <p className="live-empty">Les événements de votre rôle apparaîtront ici dès qu’ils se produisent.</p>
        ) : (
          <ol className="live-list" aria-live="polite">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, transform: 'translateY(-8px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.3 }}>
                  <time dateTime={e.receivedAt.toISOString()}>{time.format(e.receivedAt)}</time>
                  <code>{e.event}</code>
                  {'id' in e.payload && <span className="live-ref">#{String(e.payload.id)}</span>}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </section>
    </main>
  )
}
