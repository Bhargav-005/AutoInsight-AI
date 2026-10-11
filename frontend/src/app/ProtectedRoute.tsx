import { Navigate, Outlet, useLocation } from 'react-router'
import { Empty, ResourceFeedback } from '../components/ui'
import { useSession } from './session'

export default function ProtectedRoute() {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading')
    return (
      <main className="route-loading">
        <ResourceFeedback state={{ kind: 'loading' }} />
      </main>
    )
  if (session.status === 'network')
    return (
      <main className="route-loading">
        <Empty
          title="Your workspace is temporarily unavailable."
          action={
            <button className="button" onClick={() => void session.refresh()}>
              Retry connection
            </button>
          }
        >
          {session.message} Your account data has not been loaded.
        </Empty>
      </main>
    )
  if (session.status !== 'authenticated')
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
          expired: session.status === 'expired',
        }}
      />
    )
  return <Outlet />
}
