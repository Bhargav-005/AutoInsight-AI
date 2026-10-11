import { useState } from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  Dialog,
  Empty,
  Notice,
  PageHeader,
  Panel,
} from '../components/ui'

export default function History() {
  const { fixture } = usePreview()
  const [query, setQuery] = useState('')
  const [type, setType] = useState('All')
  const [ascending, setAscending] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const records = (fixture?.history ?? [])
    .filter(
      (item) =>
        (type === 'All' || item.type === type) &&
        item.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
    )
  const detail = fixture?.history.find((item) => item.id === selected)
  return (
    <>
      <PageHeader
        eyebrow="A RECORD OF YOUR REASONING"
        title="Reports & history"
        description="Return to the question, the method, and the evidence."
      />
      <div className="history-intro">
        <FileText size={29} />
        <div>
          <h2>Insights deserve a paper trail.</h2>
          <p>
            Investigations, experiments and reports will form a traceable record
            of your work.
          </p>
        </div>
        <Badge>Reporting · Phase 8</Badge>
      </div>
      {fixture && (
        <Notice>
          These entries are synthetic layout examples. They are not saved
          investigations, completed jobs or generated reports.
        </Notice>
      )}
      <Panel
        title="Workspace history"
        subtitle={
          fixture ? 'Development fixtures only' : 'No history service connected'
        }
      >
        <div className="history-filters">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search sample history"
              placeholder="Search sample history…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!fixture}
            />
          </label>
          <label className="inline-label">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!fixture}
            >
              {['All', 'Research', 'Experiment', 'Report'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={!fixture}
            onClick={() => setAscending(!ascending)}
          >
            Date: {ascending ? 'oldest first' : 'newest first'}
          </button>
        </div>
        {!fixture ? (
          <Empty title="Nothing to look back on. Yet.">
            Saved investigations and downloadable reports will appear here when
            their services are connected.
          </Empty>
        ) : records.length ? (
          <div className="history-list">
            {records.map((item) => (
              <article key={item.id}>
                <span className="history-icon">
                  <FileText size={21} />
                </span>
                <div>
                  <button
                    className="history-title"
                    onClick={() => setSelected(item.id)}
                  >
                    {item.title}
                  </button>
                  <p>
                    Retail operations · {item.type} ·{' '}
                    <time dateTime={item.date}>{item.date}</time> (sample)
                  </p>
                </div>
                <Badge tone="copper">{item.status}</Badge>
                <button
                  className="icon-button"
                  aria-label={`Download ${item.title} unavailable; no artifact exists`}
                  disabled
                >
                  <Download size={18} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No matching examples">
            Try another search term or type.
          </Empty>
        )}
      </Panel>
      <Dialog
        open={!!detail}
        close={() => setSelected(null)}
        title={detail?.title ?? 'Report details'}
      >
        <div className="dialog-body">
          <Badge tone="copper">Synthetic layout example</Badge>
          <p>Dataset: Retail operations · Sample v1</p>
          <p>
            This entry demonstrates the details panel. It has no stored report,
            experiment metrics, job ID or downloadable artifact.
          </p>
          <ol className="audit-list">
            <li>
              Source association <span>Illustrated only</span>
            </li>
            <li>
              Evidence manifest <span>Not generated</span>
            </li>
            <li>
              Report artifact <span>Not generated</span>
            </li>
          </ol>
          <button className="button" disabled>
            <Download size={17} />
            Download unavailable
          </button>
        </div>
      </Dialog>
    </>
  )
}
