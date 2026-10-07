import { createContext, useContext } from 'react'

import type { User } from '../api'

export interface Registration {
  username: string
  email: string
  password: string
  first_name: string
  last_name: string
  phone: string
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User }

export interface Auth {
  state: AuthState
  login: (username: string, password: string) => Promise<User>
  register: (data: Registration) => Promise<User>
  logout: () => void
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
