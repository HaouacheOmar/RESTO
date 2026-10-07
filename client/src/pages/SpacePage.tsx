import { AnimatePresence, motion } from 'motion/react'
import { LogOut, Radio } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'

import type { User } from '../api'
import { canOpen, homeOf, roleOfSlug, SPACES } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import { rise, stagger } from '../motion'
import { useRealtime, type LiveStatus } from '../realtime'
import './space.css'

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
        : <Space roleTitle={SPACES[role].title} upcoming={SPACES[role].upcoming} />)}
    </RequireAuth>
  )
}

function Space({ roleTitle, upcoming }: { roleTitle: string; upcoming: string[] }) {
  const { state, logout } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null
  const { status, events } = useRealtime(user !== null)
  if (!user) return null
  const name = user.first_name || user.username

  return (
    <div className="space">
      <header className="space-header on-dark">
        <div className="space-header-inner">
          <Link to="/" className="logo">RESTO</Link>
          <span className="space-role">{roleTitle}</span>
          <button type="button" className="space-logout" onClick={logout}>
            <LogOut aria-hidden="true" size={16} /> Déconnexion
          </button>
        </div>
      </header>

      <main className="space-main">
        <motion.section className="space-intro" variants={stagger(0.08)} initial="hidden" animate="show">
          <motion.p variants={rise} className="eyebrow">{roleTitle}</motion.p>
          <motion.h1 variants={rise}>Bonjour {name}.</motion.h1>
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
    </div>
  )
}
