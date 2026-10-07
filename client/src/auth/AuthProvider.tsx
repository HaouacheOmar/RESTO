import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, session, type User } from '../api'
import { AuthContext, type Auth, type AuthState, type Registration } from './useAuth'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    session.hasRefresh() ? { status: 'loading' } : { status: 'anonymous' })

  // Restore the session after a reload, and drop it when the refresh token is rejected.
  useEffect(() => {
    const stop = session.onExpired(() => setState({ status: 'anonymous' }))
    if (session.hasRefresh()) {
      api<User>('me')
        .then((user) => setState({ status: 'authenticated', user }))
        .catch(() => setState({ status: 'anonymous' }))
    }
    return stop
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await api<{ access: string; refresh: string }>('token', {
      method: 'POST', body: { username, password }, auth: false,
    })
    session.start(tokens)
    const user = await api<User>('me')
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const register = useCallback(async (data: Registration) => {
    await api('register', { method: 'POST', body: data, auth: false })
    return login(data.username, data.password)
  }, [login])

  const logout = useCallback(() => {
    session.end()
    setState({ status: 'anonymous' })
  }, [])

  const auth = useMemo<Auth>(() => ({ state, login, register, logout }), [state, login, register, logout])
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}
