import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { api, ApiError, type User } from '../api/client'
import { SessionContext, type SessionStatus } from './session'

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: SessionStatus
    user: User | null
    message: string
  }>({ status: 'loading', user: null, message: '' })
  const user = useRef<User | null>(null)
  const generation = useRef(0)
  const mutation = useRef(false)
  const invalidate = useCallback(() => {
    ++generation.current
  }, [])
  const location = useLocation()
  const needsSession =
    location.pathname !== '/' && location.pathname !== '/status'
  const refresh = useCallback(async () => {
    if (mutation.current) return
    const version = ++generation.current
    try {
      const account = await api<User>('/auth/me')
      if (version !== generation.current) return
      user.current = account
      setState({ status: 'authenticated', user: account, message: '' })
    } catch (error) {
      if (version !== generation.current) return
      const missing = error instanceof ApiError && error.status === 401
      const expired = missing && user.current !== null
      user.current = null
      setState({
        status: expired ? 'expired' : missing ? 'unauthenticated' : 'network',
        user: null,
        message: missing ? '' : (error as Error).message,
      })
    }
  }, [])
  useEffect(() => {
    if (!needsSession) return
    void refresh()
    const focus = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', focus)
    window.addEventListener('pageshow', focus)
    const timer = setInterval(focus, 60_000)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('pageshow', focus)
      clearInterval(timer)
      invalidate()
    }
  }, [needsSession, refresh, invalidate])
  useEffect(() => {
    const expired = () => {
      ++generation.current
      user.current = null
      setState({ status: 'expired', user: null, message: '' })
    }
    window.addEventListener('autoinsight:session-expired', expired)
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('autoinsight-session')
        : null
    if (channel) channel.onmessage = expired
    return () => {
      window.removeEventListener('autoinsight:session-expired', expired)
      channel?.close()
    }
  }, [])
  async function authenticate(
    register: boolean,
    data: { email: string; password: string; display_name?: string },
  ) {
    const version = ++generation.current
    mutation.current = true
    try {
      const account = await api<User>(
        register ? '/auth/register' : '/auth/login',
        { method: 'POST', body: data },
      )
      if (version !== generation.current) return
      user.current = account
      setState({ status: 'authenticated', user: account, message: '' })
    } finally {
      mutation.current = false
    }
  }
  async function logout() {
    ++generation.current
    mutation.current = true
    try {
      try {
        await api('/auth/logout', { method: 'POST' })
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error
      }
      user.current = null
      setState({ status: 'unauthenticated', user: null, message: '' })
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('autoinsight-session')
        channel.postMessage('logout')
        channel.close()
      }
    } finally {
      mutation.current = false
    }
  }
  return (
    <SessionContext.Provider
      value={{ ...state, refresh, authenticate, logout }}
    >
      {children}
    </SessionContext.Provider>
  )
}
