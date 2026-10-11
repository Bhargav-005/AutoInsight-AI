import { createContext, useContext } from 'react'
import type { User } from '../api/client'

export type SessionStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'network'
  | 'expired'
export interface SessionState {
  status: SessionStatus
  user: User | null
  message: string
  refresh: () => Promise<void>
  authenticate: (
    register: boolean,
    data: { email: string; password: string; display_name?: string },
  ) => Promise<void>
  logout: () => Promise<void>
}
export const SessionContext = createContext<SessionState | null>(null)
export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionProvider is required')
  return session
}

export function safeDestination(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(dashboard|datasets|research|analysis|models|history)(\/|\?|$)/.test(
      value,
    ) &&
    !value.includes('\\')
    ? value
    : '/dashboard'
}
