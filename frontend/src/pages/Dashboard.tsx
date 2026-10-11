import { useEffect, useState } from 'react'
import { api, type Overview } from '../api/client'
import { useSession } from '../app/session'
import { Link } from 'react-router'
import {
  ArrowRight,
  ArrowUpRight,
  Database,
  FileCheck2,
  FlaskConical,
  Network,
  Plus,
  Workflow,
} from 'lucide-react'
import { usePreview } from '../app/preview'
import { Badge, Empty, PageHeader, Panel, Stat } from '../components/ui'

export default function Dashboard() {
  const { fixture } = usePreview()
  const { user } = useSession()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (fixture) return
    let active = true
    const controller = new AbortController()
    api<Overview>('/dashboard/overview', { signal: controller.signal })
      .then((data) => {
        if (active) setOverview(data)
      })
      .catch((reason) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [fixture, retry])
  return (
    <>
      <PageHeader
        eyebrow="YOUR ANALYTICAL WORKSPACE"
        title="A clearer view starts here."
        description={`Welcome, ${user?.display_name ?? 'analyst'}. Bring your data, questions and evidence into one considered workflow.`}
        actions={
          <Link className="button" to="/datasets">
            <Plus size={17} />
            Explore datasets
          </Link>
        }
      />
      {!fixture && error && (
        <div className="notice" role="alert">
          {error} Account statistics are unavailable.
          <button
            className="text-button"
            onClick={() => {
              setError('')
              setOverview(null)
              setRetry(retry + 1)
            }}
          >
            Retry overview
          </button>
        </div>
      )}
      {!fixture && !overview && !error && (
        <p role="status">Loading your account statistics…</p>
      )}
      <div className="stats-grid">
        <Stat
          label="Datasets"
          value={
            fixture
              ? '01'
              : overview && !error
                ? String(overview.datasets)
                : '—'
          }
          detail={
            fixture
              ? 'Synthetic retail sample'
              : overview && !error
                ? 'Datasets owned by your account'
                : 'Waiting for account data'
          }
          icon={<Database size={19} />}
        />
        <Stat
          label="Research runs"
          value={
            overview && !error && !fixture
              ? String(overview.research_runs)
              : '—'
          }
          detail="Investigations connect in Phase 7"
          icon={<Network size={19} />}
        />
        <Stat
          label="ML experiments"
          value={
            overview && !error && !fixture
              ? String(overview.ml_experiments)
              : '—'
          }
          detail="Training connects in Phase 6"
          icon={<FlaskConical size={19} />}
        />
        <Stat
          label="Evidence reports"
          value={
            overview && !error && !fixture ? String(overview.reports) : '—'
          }
          detail="Reporting connects in Phase 8"
          icon={<FileCheck2 size={19} />}
        />
      </div>
      <div className="dashboard-grid">
        <Panel
          title="Your datasets"
          subtitle="The foundation of every investigation"
          action={
            <Link className="text-link" to="/datasets">
              View workspace <ArrowUpRight size={15} />
            </Link>
          }
        >
          {fixture ? (
            <Link className="dataset-overview" to="/datasets/sample-retail">
              <div className="file-tile">
                <Database size={28} />
                <span>CSV</span>
              </div>
              <div>
                <Badge tone="copper">Synthetic sample</Badge>
                <h3>Retail operations</h3>
                <p>12 rows · 6 columns · Sample v1</p>
                <span className="text-link">
                  Inspect dataset <ArrowRight size={15} />
                </span>
              </div>
              <div className="mini-bars" aria-hidden="true">
                {[35, 65, 48, 86, 60, 94, 73, 100].map((n, i) => (
                  <span key={i} style={{ height: `${n}%` }} />
                ))}
              </div>
            </Link>
          ) : (
            <Empty
              title="Good questions need a starting point."
              action={
                <Link className="button secondary" to="/datasets">
                  Discover the dataset workspace <ArrowRight size={16} />
                </Link>
              }
            >
              Dataset ingestion arrives in Phase 4. Your account statistics
              above come from your own database records.
            </Empty>
          )}
          <div className="panel-bottom">
            <span className="subtle-dot" />
            Original data stays immutable. Every change will carry its own
            history.
          </div>
        </Panel>
        <section className="research-feature">
          <div className="feature-label">
            <Network size={18} />A DIFFERENT KIND OF AI WORKSPACE
          </div>
          <h2>
            Seven perspectives.
            <br />
            <em>One traceable process.</em>
          </h2>
          <p>
            Follow the journey from a question to a finding. Inspect the plan,
            the tools and the evidence along the way.
          </p>
          <div className="orbit-diagram" aria-hidden="true">
            {['01', '02', '03', '04', '05', '06', '07'].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <Link to="/research/preview" className="button light">
            Explore the research workspace <ArrowUpRight size={16} />
          </Link>
          <small>Architecture preview · No agents running</small>
        </section>
      </div>
      <div className="two-column">
        <Panel
          title="Recent operations"
          subtitle="A record you can follow"
          action={
            <Link className="text-link" to="/history">
              View history <ArrowUpRight size={15} />
            </Link>
          }
        >
          <div className="quiet-row">
            <Workflow size={23} />
            <div>
              <h3>Activity workflows are not connected yet</h3>
              <p>
                Real jobs and their outcomes will appear here. Nothing is
                currently submitted by this interface.
              </p>
            </div>
          </div>
          <div className="operation-legend">
            <Badge>Queued</Badge>
            <Badge tone="teal">In progress</Badge>
            <Badge tone="copper">Needs review</Badge>
            <span>State legend</span>
          </div>
        </Panel>
        <Panel
          title="Make your first connection"
          subtitle="A considered path through your work"
        >
          <ol className="getting-started">
            {[
              [
                '01',
                'Understand the dataset',
                'Inspect columns, quality and context.',
                '/datasets',
              ],
              [
                '02',
                'Shape your investigation',
                'Review the plan before execution.',
                '/research/preview',
              ],
              [
                '03',
                'Make the evidence visible',
                'Explore charts and their sources.',
                '/analysis/sample-retail',
              ],
            ].map(([n, title, detail, path]) => (
              <li key={n}>
                <Link to={path}>
                  <span>{n}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </div>
                  <ArrowUpRight size={16} />
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  )
}
