import { LogOut } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'

import type { Role, User } from '../api'
import { canOpen, homeOf, roleOfSlug, SPACES } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import './space.css'

/** One space per role, loaded on demand: each role only downloads its own screen. */
const CONTENT: Record<Role, LazyExoticComponent<ComponentType<{ user: User }>>> = {
  CLIENT: lazy(() => import('./client/ClientSpace')),
  RESERVATION_MANAGER: lazy(() => import('./desk/DeskSpace')),
  PARKING_ATTENDANT: lazy(() => import('./parking/ParkingSpace')),
  SERVER: lazy(() => import('./floor/FloorSpace')),
  CASHIER: lazy(() => import('./till/TillSpace')),
  DELIVERER: lazy(() => import('./driver/DriverSpace')),
  CHEF: lazy(() => import('./chef/ChefSpace')),
  ADMIN_MANAGER: lazy(() => import('./manager/ManagerSpace')),
  STOCK_MANAGER: lazy(() => import('./stock/StockSpace')),
}

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
      <Suspense fallback={<p className="page-loading" role="status">Chargement…</p>}><Content user={state.user} /></Suspense>
    </div>
  )
}
