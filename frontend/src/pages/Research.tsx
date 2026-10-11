import { useState } from 'react'
import {
  BookOpen,
  CheckCheck,
  Database,
  FileText,
  FlaskConical,
  Network,
  SearchCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  Empty,
  FutureButton,
  Notice,
  PageHeader,
  Panel,
  TabPanel,
  Tabs,
} from '../components/ui'

const roles = [
  {
    name: 'Data Understanding',
    task: 'Inspect schema, types and the meaning of each column before proposing an investigation.',
    tool: 'Profile & schema inspection',
    icon: Database,
  },
  {
    name: 'Data Cleaning',
    task: 'Propose transformations and wait for explicit approval. Preserve source data and lineage.',
    tool: 'Approved cleaning tools',
    icon: SlidersHorizontal,
  },
  {
    name: 'Data Analysis',
    task: 'Use deterministic tools to compute aggregates and comparisons from an approved dataset version.',
    tool: 'run_aggregate · chart generation',
    icon: SearchCheck,
  },
  {
    name: 'ML Engineer',
    task: 'Build leakage-safe pipelines, compare baselines and report actual held-out metrics.',
    tool: 'Controlled experiment tools',
    icon: FlaskConical,
  },
  {
    name: 'Research & Verification',
    task: 'Check whether findings follow from the evidence and make uncertainty visible.',
    tool: 'Evidence validation',
    icon: CheckCheck,
  },
  {
    name: 'RAG Knowledge',
    task: 'Retrieve scoped references for methodology. Retrieved text does not replace computation.',
    tool: 'Scoped knowledge retrieval',
    icon: BookOpen,
  },
  {
    name: 'Report & Insights',
    task: 'Assemble traceable findings, methodology, limitations and source references.',
    tool: 'Evidence-linked reporting',
    icon: FileText,
  },
]
export default function Research() {
  const { fixture } = usePreview()
  const [role, setRole] = useState(0)
  const [view, setView] = useState('workflow')
  const [objective, setObjective] = useState('')
  const [plan, setPlan] = useState(false)
  const [review, setReview] = useState('')
  return (
    <>
      <PageHeader
        eyebrow="THE INVESTIGATION ROOM"
        title="Follow the reasoning."
        description="A question, a deliberate plan, and evidence you can inspect."
        actions={
          <Badge tone="copper">Architecture preview · No execution</Badge>
        }
      />
      <Notice dismissible>
        These seven roles illustrate the approved architecture. No model, tool
        or agent has run. Research execution connects in Phase 7.
      </Notice>
      <div className="research-grid">
        <Panel
          title="Investigation brief"
          subtitle="Start with a useful question"
          className="brief-panel"
        >
          <label>
            Research objective
            <textarea
              rows={5}
              value={objective}
              onChange={(e) => {
                setObjective(e.target.value)
                setPlan(false)
                setReview('')
              }}
              placeholder="What patterns should we investigate, and why do they matter?"
            />
          </label>
          <div className="context-block">
            <span className="eyebrow">DATASET CONTEXT</span>
            <strong>
              {fixture ? 'Retail operations' : 'No connected dataset'}
            </strong>
            <small>
              {fixture
                ? 'Sample v1 · Synthetic fixture'
                : 'A dataset will be required for execution.'}
            </small>
          </div>
          <button
            className="button secondary full-width"
            disabled={!objective.trim()}
            onClick={() => setPlan(true)}
          >
            View illustrative plan
          </button>
          {plan && (
            <div className="local-plan">
              <Badge tone="copper">Static plan template</Badge>
              <ol>
                <li>Inspect the dataset and its quality.</li>
                <li>Confirm scope and any cleaning steps.</li>
                <li>Compute, verify and report evidence.</li>
              </ol>
              <small>This template is not an AI-generated plan.</small>
              <div className="button-row">
                <button
                  className="text-button"
                  onClick={() =>
                    setReview(
                      'Preview approved locally. Execution is unavailable; nothing was saved.',
                    )
                  }
                >
                  Preview approval
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setReview('Preview rejected locally. Nothing was saved.')
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          )}
          {review && (
            <p className="inline-status" role="status">
              {review}
            </p>
          )}
          <FutureButton phase={7}>Start investigation</FutureButton>
        </Panel>
        <Panel
          title="Seven roles. A visible process."
          subtitle="Select a role to inspect its responsibility"
          className="workflow-panel"
        >
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { id: 'workflow', label: 'Role map' },
              { id: 'trace', label: 'Execution trace' },
            ]}
          />
          <TabPanel id={view}>
            {view === 'workflow' ? (
              <>
                <div className="coordination">
                  <Network size={17} />
                  <span>LangGraph coordination</span>
                  <small>Infrastructure, not an eighth agent</small>
                </div>
                <div className="agent-flow">
                  {roles.map(({ name, icon: Icon }, index) => (
                    <button
                      className={`agent-node ${role === index ? 'selected' : ''}`}
                      key={name}
                      onClick={() => setRole(index)}
                      aria-pressed={role === index}
                    >
                      <span className="node-number">0{index + 1}</span>
                      <Icon size={19} />
                      <strong>{name}</strong>
                      <span className="node-indicator" />
                    </button>
                  ))}
                </div>
                <p className="chart-note">
                  Logical responsibilities, not a fixed execution sequence. All
                  roles share one controlled Ollama model.
                </p>
              </>
            ) : (
              <Empty title="An honest trace starts with a real run.">
                Tool calls, timings, progress and outcomes will appear here
                after execution is connected. No steps are running.
              </Empty>
            )}
          </TabPanel>
        </Panel>
        <Panel
          title="Role & evidence inspector"
          subtitle="Understand what supports a finding"
          className="inspector-panel"
        >
          <Badge tone="teal">ROLE 0{role + 1}</Badge>
          <h3 className="inspector-title">{roles[role].name}</h3>
          <p>{roles[role].task}</p>
          <div className="context-block">
            <span className="eyebrow">ANTICIPATED TOOLS</span>
            <strong>{roles[role].tool}</strong>
            <small>Allowlisted operations only</small>
          </div>
          <div className="evidence-empty">
            <FileText size={24} />
            <h3>No computed evidence</h3>
            <p>No tool calls, findings or citations exist for this preview.</p>
          </div>
          <details>
            <summary>Evidence contract</summary>
            <p>
              Each numerical claim must link to a dataset version, a computation
              and its stored result. Interpretations and retrieved references
              remain distinct from measurements.
            </p>
          </details>
          <div className="warning-note">
            Approval and ownership checks will run on the backend. This
            interface cannot authorize execution.
          </div>
        </Panel>
      </div>
    </>
  )
}
