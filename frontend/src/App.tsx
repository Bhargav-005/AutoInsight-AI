import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { PreviewContext } from './app/preview'
import type { WorkspaceFixture } from './types/domain'
import Shell from './layouts/Shell'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import HealthPanel from './components/HealthPanel'
import { Empty, ResourceFeedback } from './components/ui'
import SessionProvider from './app/SessionProvider'
import ProtectedRoute from './app/ProtectedRoute'
import { useSession } from './app/session'

const Datasets = lazy(() => import('./pages/Datasets'))
const Cleaning = lazy(() => import('./pages/Cleaning'))
const Research = lazy(() => import('./pages/Research'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Models = lazy(() => import('./pages/Models'))
const History = lazy(() => import('./pages/History'))
const Landing = lazy(() => import('./pages/Landing'))

export function AppRoutes() {
  const { user } = useSession()
  return <SessionRoutes key={user?.id ?? 'public'} />
}

function SessionRoutes() {
  const [fixture, setFixture] = useState<WorkspaceFixture | null>(null)
  const [loading, setLoading] = useState(false)
  async function toggle() {
    if (fixture) {
      setFixture(null)
      return
    }
    if (
      import.meta.env.DEV &&
      import.meta.env.VITE_ENABLE_VISUAL_SAMPLES === 'true'
    ) {
      setLoading(true)
      try {
        const { workspace } = await import('./fixtures/workspace')
        setFixture(workspace)
      } finally {
        setLoading(false)
      }
    }
  }
  return (
    <PreviewContext.Provider value={{ fixture, loading, toggle }}>
      <Suspense
        fallback={
          <div className="route-loading">
            <ResourceFeedback state={{ kind: 'loading' }} />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth key="login" />} />
          <Route path="/register" element={<Auth register key="register" />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Shell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/datasets" element={<Datasets />} />
              <Route path="/datasets/:id" element={<Datasets />} />
              <Route path="/datasets/:id/clean" element={<Cleaning />} />
              <Route path="/research/:id" element={<Research />} />
              <Route path="/analysis/:id" element={<Analytics />} />
              <Route path="/models/:id" element={<Models />} />
              <Route path="/history" element={<History />} />
            </Route>
          </Route>
          <Route element={<Shell />}>
            <Route path="/status" element={<HealthPanel />} />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <Empty
                    title="This path does not lead to a workspace."
                    action={
                      <Link className="button" to="/dashboard">
                        Return to dashboard
                      </Link>
                    }
                  >
                    Check the address or use the navigation to continue.
                  </Empty>
                </>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </PreviewContext.Provider>
  )
}
export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </BrowserRouter>
  )
}
