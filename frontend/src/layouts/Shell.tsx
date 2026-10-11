import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react'
import { usePreview } from '../app/preview'
import { useSession } from '../app/session'
import { Badge, Dialog } from '../components/ui'

const navigation = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Datasets', path: '/datasets', icon: Database },
  {
    label: 'Cleaning Studio',
    path: '/datasets/sample-retail/clean',
    icon: SlidersHorizontal,
  },
  { label: 'AI Research', path: '/research/preview', icon: Network },
  { label: 'Analytics', path: '/analysis/sample-retail', icon: BarChart3 },
  { label: 'ML Studio', path: '/models/preview', icon: FlaskConical },
  { label: 'Reports & History', path: '/history', icon: History },
]

export default function Shell() {
  const session = useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  async function signOut() {
    setSigningOut(true)
    setLogoutError('')
    try {
      await session.logout()
      setAccount(false)
      navigate('/login', { replace: true })
    } catch (error) {
      setLogoutError((error as Error).message)
    } finally {
      setSigningOut(false)
    }
  }
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [account, setAccount] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { fixture, toggle, loading } = usePreview()
  const drawer = useRef<HTMLDialogElement>(null)
  const mobileButton = useRef<HTMLButtonElement>(null)
  const current = location.pathname.includes('/clean')
    ? 'Cleaning Studio'
    : location.pathname.startsWith('/datasets')
      ? 'Datasets'
      : (navigation.find((item) =>
          location.pathname.startsWith(
            item.path.split('/').slice(0, 2).join('/'),
          ),
        )?.label ?? 'System status')
  useEffect(() => {
    document.title = `${current} · AutoInsight AI`
    document
      .querySelector<HTMLElement>('.page-content h1')
      ?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [location.pathname, current])
  useEffect(() => {
    if (!mobile) return
    const element = drawer.current
    const trigger = mobileButton.current
    element?.showModal()
    return () => {
      element?.close()
      trigger?.focus()
    }
  }, [mobile])
  const links = (small = false) => (
    <>
      <Link
        to="/dashboard"
        className="brand"
        onClick={() => setMobile(false)}
        aria-label="AutoInsight AI dashboard"
      >
        <span className="brand-mark" aria-hidden="true">
          <BarChart3 size={22} />
        </span>
        {(!collapsed || small) && (
          <span>
            AutoInsight<span className="brand-ai">AI</span>
          </span>
        )}
      </Link>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label={small ? 'Mobile navigation' : 'Main navigation'}>
        {navigation.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={label}
            to={path}
            end={path === '/datasets'}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={current === label ? 'page' : undefined}
            className={({ isActive }) =>
              `nav-link ${isActive || current === label ? 'active' : ''}`
            }
            onClick={() => setMobile(false)}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
            {label === 'AI Research' && <span className="nav-new">7</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-workspace">
          <ShieldCheck size={19} />
          <div>
            <strong>Local workspace</strong>
            <small>Your data stays with you</small>
          </div>
        </div>
        <Link
          to="/status"
          className="nav-link"
          title={collapsed ? 'System status' : undefined}
          aria-label="System status"
          onClick={() => setMobile(false)}
        >
          <Activity size={19} />
          <span>System status</span>
        </Link>
        {!small && (
          <button
            className="nav-link collapse-control"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronsRight size={19} />
            ) : (
              <ChevronsLeft size={19} />
            )}
            <span>Collapse sidebar</span>
          </button>
        )}
      </div>
    </>
  )
  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">{links()}</aside>
      <dialog
        className="mobile-drawer"
        ref={drawer}
        aria-label="Navigation"
        onCancel={() => setMobile(false)}
      >
        <button
          className="drawer-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X size={21} />
        </button>
        {links(true)}
      </dialog>
      <div className="workspace">
        <header className="topbar">
          <button
            ref={mobileButton}
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{current}</strong>
          </div>
          <div className="topbar-actions">
            {[
              'Cleaning Studio',
              'Analytics',
              'ML Studio',
              'AI Research',
            ].includes(current) && (
              <label className="context-selector">
                <span className="sr-only">Dataset context</span>
                <select
                  value={fixture ? 'sample-retail' : ''}
                  onChange={() => navigate('/datasets')}
                >
                  <option value="">No connected dataset</option>
                  {fixture && (
                    <option value="sample-retail">
                      Retail operations · Sample
                    </option>
                  )}
                </select>
              </label>
            )}
            <Link
              to="/status"
              className="system-link"
              aria-label="Service status"
            >
              <Activity size={16} />
              <span>Service status</span>
            </Link>
            <button
              className="avatar"
              aria-label="Open account information"
              onClick={() => setAccount(true)}
            >
              <UserRound size={18} />
            </button>
          </div>
        </header>
        <div className="preview-banner">
          <div>
            <span className="preview-dot" />
            <strong>
              {fixture
                ? 'Interface preview'
                : session.user
                  ? session.user.display_name
                  : 'Public diagnostics'}
            </strong>
            <span className="preview-description">
              {fixture
                ? 'Synthetic sample data. Nothing is saved or executed.'
                : session.user
                  ? 'Signed in. Data processing connects in later phases.'
                  : 'Sign in to access your workspace.'}
            </span>
          </div>
          {session.user &&
            import.meta.env.DEV &&
            import.meta.env.VITE_ENABLE_VISUAL_SAMPLES === 'true' && (
              <button
                className="text-button"
                disabled={loading}
                onClick={toggle}
              >
                {loading
                  ? 'Loading sample…'
                  : fixture
                    ? 'Leave sample workspace'
                    : 'Explore sample workspace'}
                <ArrowUpRight size={14} />
              </button>
            )}
        </div>
        <main className="page-content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>
            AutoInsight AI <span aria-hidden="true">/</span> Explainable by
            design.
          </span>
          <span>
            Account foundation <Badge>Phase 3</Badge>
          </span>
        </footer>
      </div>
      <Dialog
        open={account}
        close={() => setAccount(false)}
        title="Your workspace account"
      >
        <div className="dialog-body">
          <UserRound size={32} />
          <h3>{session.user?.display_name ?? 'You are not signed in.'}</h3>
          {session.user ? (
            <>
              <p>{session.user.email}</p>
              <p>
                Account created{' '}
                {new Date(session.user.created_at).toLocaleDateString()}. Your
                session is managed by the local API.
              </p>
              <button
                className="button"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              {logoutError && (
                <p role="alert">
                  {logoutError} Your session has not been confirmed as revoked.
                </p>
              )}
            </>
          ) : (
            <Link
              className="button"
              to="/login"
              onClick={() => setAccount(false)}
            >
              Sign in
            </Link>
          )}
        </div>
      </Dialog>
    </div>
  )
}
