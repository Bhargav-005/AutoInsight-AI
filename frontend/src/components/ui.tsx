import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Inbox,
  Search,
  X,
} from 'lucide-react'
import type { DataRow, ResourceState } from '../types/domain'

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'teal' | 'copper' | 'error'
}) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1}>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={25} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}
export function Notice({
  children,
  dismissible = false,
}: {
  children: ReactNode
  dismissible?: boolean
}) {
  const [visible, setVisible] = useState(true)
  return visible ? (
    <div className="notice">
      <CircleAlert size={17} aria-hidden="true" />
      <div>{children}</div>
      {dismissible && (
        <button
          className="icon-button"
          aria-label="Dismiss notice"
          onClick={() => setVisible(false)}
        >
          <X size={17} />
        </button>
      )}
    </div>
  ) : null
}
export function FutureButton({
  phase,
  children,
}: {
  phase: number
  children: ReactNode
}) {
  return (
    <span className="future-action">
      <button className="button" disabled>
        {children}
      </button>
      <small>Available in Phase {phase}</small>
    </span>
  )
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}
export function Dialog({
  open,
  close,
  title,
  children,
}: {
  open: boolean
  close: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      previous?.focus()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
          autoFocus
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Workspace views">
      {items.map((item, index) => (
        <button
          key={item.id}
          role="tab"
          id={`tab-${item.id}`}
          aria-controls={`panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % items.length
                : event.key === 'ArrowLeft'
                  ? (index + items.length - 1) % items.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : -1
            if (next >= 0) {
              event.preventDefault()
              onChange(items[next].id)
              ;(
                event.currentTarget.parentElement?.children[next] as HTMLElement
              ).focus()
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
export function TabPanel({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
    >
      {children}
    </div>
  )
}
export function DataTable({
  rows,
  columns,
  caption,
  pageSize = 6,
}: {
  rows: DataRow[]
  columns: { key: string; label: string }[]
  caption: string
  pageSize?: number
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: columns[0].key, ascending: true })
  const [page, setPage] = useState(0)
  const filtered = rows
    .filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    )
    .sort((a, b) => {
      const left = a[sort.key] ?? ''
      const right = b[sort.key] ?? ''
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right))
      return sort.ascending ? order : -order
    })
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  return (
    <div className="data-table">
      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label={`Search ${caption}`}
          placeholder="Filter these rows…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
      </label>
      <div
        className="table-scroll"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort.key === column.key
                      ? sort.ascending
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    onClick={() => {
                      setSort({
                        key: column.key,
                        ascending:
                          sort.key === column.key ? !sort.ascending : true,
                      })
                      setPage(0)
                    }}
                  >
                    {column.label}
                    {sort.key === column.key &&
                      (sort.ascending ? (
                        <ArrowUp size={13} />
                      ) : (
                        <ArrowDown size={13} />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((row, index) => (
                <tr key={String(row.id ?? row.order ?? index)}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {row[column.key] === null ? (
                        <Badge tone="copper">Missing</Badge>
                      ) : (
                        row[column.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="table-empty">
            No matching rows. Try a different filter.
          </p>
        )}
      </div>
      <div className="pagination">
        <span>
          {filtered.length} rows · Page {current + 1} of {pages}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
export function ResourceFeedback({ state }: { state: ResourceState<unknown> }) {
  if (state.kind === 'success') return null
  const text = {
    loading: 'Loading workspace…',
    empty: 'Nothing here yet.',
    network: 'Connection unavailable. Your work has not been submitted.',
    unauthorized: 'Sign in is required. Authentication connects in Phase 3.',
    forbidden: 'You do not have access to this resource.',
    unsupported: 'This operation is not available yet.',
    validation: 'message' in state ? state.message : '',
    failed: 'message' in state ? state.message : '',
    running: 'Background job in progress.',
  }[state.kind]
  return (
    <div
      className={`resource-feedback ${state.kind}`}
      role={
        state.kind === 'failed' || state.kind === 'validation'
          ? 'alert'
          : 'status'
      }
    >
      {state.kind === 'loading' && <div className="skeleton" />}
      {text}
      {state.kind === 'running' && (
        <progress
          max={100}
          value={state.progress ?? undefined}
          aria-label="Job progress"
        />
      )}
    </div>
  )
}
