import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CheckCheck,
  ChevronRight,
  Database,
  FileCheck2,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  Menu,
  Network,
  SearchCheck,
  SlidersHorizontal,
  UploadCloud,
  X,
} from 'lucide-react'
import './landing.css'

const capabilities = [
  {
    title: 'Understand the source.',
    label: 'Dataset understanding',
    icon: Database,
    description:
      'Explore structure, types and missing values. Give every investigation the context it needs.',
    phase: 'Profiling · Phase 4',
  },
  {
    title: 'Prepare with intention.',
    label: 'Data cleaning',
    icon: SlidersHorizontal,
    description:
      'Review suggested changes before applying them. Keep original data and a clear version history.',
    phase: 'Execution · Phase 5',
  },
  {
    title: 'Make patterns visible.',
    label: 'Interactive analytics',
    icon: BarChart3,
    description:
      'Move between charts and the computations behind them, with the dataset version always in view.',
    phase: 'Computations · Phase 5',
  },
  {
    title: 'Measure what matters.',
    label: 'Machine learning',
    icon: FlaskConical,
    description:
      'Compare models against baselines and inspect held-out results, methods and limitations.',
    phase: 'Training · Phase 6',
  },
  {
    title: 'Follow the investigation.',
    label: 'Multi-agent research',
    icon: Network,
    description:
      'Seven focused roles coordinate a bounded research plan, with tool calls and evidence made inspectable.',
    phase: 'Orchestration · Phase 7',
  },
  {
    title: 'Keep the evidence close.',
    label: 'Evidence-based reporting',
    icon: FileCheck2,
    description:
      'Connect findings to their sources, methods and caveats. Build a report that can explain itself.',
    phase: 'Generation · Phase 8',
  },
]
const steps = [
  { label: 'Upload', icon: UploadCloud, detail: 'Bring a tabular source' },
  { label: 'Understand', icon: Database, detail: 'Establish the context' },
  { label: 'Clean', icon: SlidersHorizontal, detail: 'Approve the changes' },
  { label: 'Analyze', icon: BarChart3, detail: 'Compute the patterns' },
  { label: 'Model', icon: FlaskConical, detail: 'Evaluate fairly' },
  { label: 'Research', icon: Network, detail: 'Verify the reasoning' },
  { label: 'Report', icon: FileText, detail: 'Trace every finding' },
]
const agents = [
  {
    title: 'Data Understanding',
    icon: Database,
    verb: 'Context before computation.',
    description:
      'Inspects schema, data types and quality to establish what the dataset can support. Turns an unfamiliar source into a grounded starting point.',
    input: 'Dataset schema & profile',
    output: 'Dataset context & quality observations',
  },
  {
    title: 'Data Cleaning',
    icon: SlidersHorizontal,
    verb: 'A deliberate change. A visible history.',
    description:
      'Proposes transformations for review. Meaningful changes require human approval, and derived versions retain a link to their original source.',
    input: 'Quality issues & approved scope',
    output: 'Proposed cleaning plan & lineage',
  },
  {
    title: 'Data Analysis',
    icon: BarChart3,
    verb: 'Compute first. Interpret second.',
    description:
      'Uses allowlisted deterministic tools for aggregates, comparisons and charts. Numerical claims must come from computed results, not generated prose.',
    input: 'Approved dataset version & question',
    output: 'Computed results & chart evidence',
  },
  {
    title: 'ML Engineer',
    icon: FlaskConical,
    verb: 'Better questions for better models.',
    description:
      'Defines a suitable task, separates training and evaluation data, and compares candidate models against a baseline. Reports actual held-out metrics.',
    input: 'Confirmed task, target & dataset',
    output: 'Experiment configuration & evaluation',
  },
  {
    title: 'Research & Verification',
    icon: CheckCheck,
    verb: 'Give every claim a second look.',
    description:
      'Checks whether findings are supported by the recorded evidence. Makes uncertainty, conflicting results and methodological limitations visible.',
    input: 'Findings & supporting evidence',
    output: 'Verification notes & limitations',
  },
  {
    title: 'RAG Knowledge',
    icon: BookOpen,
    verb: 'Relevant knowledge, in context.',
    description:
      'Retrieves scoped references for methodology and data definitions. Keeps external knowledge distinct from numerical computations and dataset evidence.',
    input: 'Question & permitted documents',
    output: 'Scoped references & citations',
  },
  {
    title: 'Report & Insights',
    icon: FileText,
    verb: 'An explanation you can return to.',
    description:
      'Assembles findings, evidence, methods and caveats into a coherent report. Preserves the distinction between observations and model interpretation.',
    input: 'Verified findings & source manifest',
    output: 'Traceable report & insight narrative',
  },
]
const anchors = [
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'architecture', label: 'Architecture' },
]

function ProductIllustration() {
  return (
    <figure
      className="lp-product"
      aria-label="Concept illustration of a planned evidence-oriented workspace"
    >
      <div className="lp-product-label">
        <span>THE WORKSPACE, ENVISIONED</span>
        <span>01 / CONCEPT</span>
      </div>
      <div className="lp-window">
        <div className="lp-window-top">
          <span className="lp-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>AutoInsight / Research workspace</span>
          <span className="lp-illustration-badge">Design preview</span>
        </div>
        <div className="lp-window-body">
          <div className="lp-mini-rail" aria-hidden="true">
            <Database />
            <SlidersHorizontal />
            <BarChart3 />
            <Network className="selected" />
            <FileText />
          </div>
          <div className="lp-canvas">
            <div className="lp-canvas-title">
              <span className="lp-kicker">AN EVIDENCE-ORIENTED PROCESS</span>
              <GitBranch size={18} />
            </div>
            <h2>
              Every finding,
              <br />
              <em>a source.</em>
            </h2>
            <div className="lp-source-block">
              <Database size={21} />
              <div>
                <strong>Your dataset</strong>
                <span>Source → version → context</span>
              </div>
              <span className="lp-outline-tag">INPUT</span>
            </div>
            <div className="lp-connector" aria-hidden="true">
              <span />
              <ArrowDown size={15} />
            </div>
            <div className="lp-canvas-pair">
              <div>
                <SearchCheck size={19} />
                <strong>Understand</strong>
                <span>Inspect & question</span>
              </div>
              <div>
                <SlidersHorizontal size={19} />
                <strong>Human review</strong>
                <span>Plan & approve</span>
              </div>
            </div>
            <div className="lp-canvas-bottom">
              <div className="lp-evidence-lines" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <strong>Reasoning with a record</strong>
                <span>Methods. Evidence. Limitations.</span>
              </div>
              <FileCheck2 size={24} />
            </div>
          </div>
        </div>
      </div>
      <div className="lp-provenance-note">
        <GitBranch size={17} />
        <div>
          <strong>A path back to the source.</strong>
          <span>Provenance is part of the design.</span>
        </div>
      </div>
      <figcaption>
        Interface illustration · No analysis or agent execution
      </figcaption>
    </figure>
  )
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const active = agents[selected]
  const ActiveIcon = active.icon

  useEffect(() => {
    document.title = 'AutoInsight AI — From data to understanding'
    const elements =
      root.current?.querySelectorAll<HTMLElement>('[data-reveal]')
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!elements || media?.matches || !('IntersectionObserver' in window))
      return
    // Content starts visible. Only an observed, offscreen section gains a reveal.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove('lp-reveal-pending')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.06 },
    )
    elements.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight)
        element.classList.add('lp-reveal-pending')
      observer.observe(element)
    })
    return () => {
      observer.disconnect()
      elements.forEach((element) =>
        element.classList.remove('lp-reveal-pending'),
      )
    }
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    const dialog = menu.current
    const trigger = menuTrigger.current
    dialog?.showModal()
    const desktop = window.matchMedia('(min-width: 801px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      desktop.removeEventListener('change', closeOnDesktop)
      dialog?.close()
      trigger?.focus()
    }
  }, [menuOpen])

  function navigateSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault()
    setMenuOpen(false)
    requestAnimationFrame(() => {
      const section = document.getElementById(id)
      section?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
      section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
      window.history.replaceState(window.history.state, '', `#${id}`)
    })
  }

  const sectionLinks = anchors.map(({ id, label }) => (
    <a key={id} href={`#${id}`} onClick={(event) => navigateSection(event, id)}>
      {label}
    </a>
  ))
  return (
    <div className="landing" ref={root}>
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Link to="/" className="lp-brand" aria-label="AutoInsight AI home">
            <span className="lp-brand-symbol">
              <BarChart3 size={23} />
            </span>
            <span>
              AutoInsight <small>AI</small>
            </span>
          </Link>
          <nav className="lp-desktop-nav" aria-label="Public navigation">
            {sectionLinks}
          </nav>
          <div className="lp-header-actions">
            <Link to="/login" className="lp-signin">
              Sign In
            </Link>
            <Link to="/register" className="button">
              Get Started <ArrowUpRight size={15} />
            </Link>
          </div>
          <button
            ref={menuTrigger}
            className="icon-button lp-menu-toggle"
            aria-label="Open public navigation"
            aria-expanded={menuOpen}
            aria-controls="public-menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={23} />
          </button>
        </div>
      </header>
      <dialog
        ref={menu}
        id="public-menu"
        className="lp-mobile-menu"
        aria-label="Public navigation menu"
        onCancel={() => setMenuOpen(false)}
      >
        <div className="lp-menu-heading">
          <strong>Explore AutoInsight</strong>
          <button
            className="icon-button"
            aria-label="Close public navigation"
            onClick={() => setMenuOpen(false)}
            autoFocus
          >
            <X size={21} />
          </button>
        </div>
        <nav aria-label="Mobile public navigation">
          {sectionLinks}
          <Link to="/login" onClick={() => setMenuOpen(false)}>
            Sign In <ArrowUpRight size={16} />
          </Link>
          <Link
            to="/register"
            className="button"
            onClick={() => setMenuOpen(false)}
          >
            Get Started <ArrowRight size={16} />
          </Link>
        </nav>
        <p>A local-first platform, in development.</p>
      </dialog>
      <main id="landing-main" tabIndex={-1}>
        <section
          className="lp-hero lp-container"
          aria-labelledby="landing-title"
        >
          <div className="lp-hero-copy">
            <p className="lp-kicker">
              <span className="lp-small-rule" />
              ANALYSIS WITH A CLEAR LINE OF REASONING
            </p>
            <h1 id="landing-title">
              From raw data
              <br />
              to explainable
              <br />
              <em>intelligence.</em>
            </h1>
            <p className="lp-hero-description">
              A considered workspace for understanding data, exploring
              possibilities, and tracing every finding back to its evidence.
            </p>
            <div className="lp-hero-actions">
              <Link className="button" to="/register">
                Get Started <ArrowUpRight size={17} />
              </Link>
              <Link className="button secondary" to="/login">
                Sign In <ArrowRight size={17} />
              </Link>
            </div>
            <p className="lp-availability">
              Create an account to explore your workspace. Data processing and
              AI execution are in development.
            </p>
          </div>
          <ProductIllustration />
          <div className="lp-hero-foot">
            <span>LOCAL-FIRST BY DESIGN</span>
            <span>HUMAN-APPROVED CHANGES</span>
            <span>EVIDENCE-ORIENTED OUTPUTS</span>
            <a
              href="#features"
              onClick={(event) => navigateSection(event, 'features')}
              aria-label="Discover platform features"
            >
              <ArrowDown size={17} />
            </a>
          </div>
        </section>

        <section
          className="lp-problem lp-section"
          aria-labelledby="problem-title"
        >
          <div className="lp-container lp-problem-grid" data-reveal>
            <div>
              <p className="lp-kicker">
                LESS FRAGMENTATION. MORE UNDERSTANDING.
              </p>
              <h2 id="problem-title" className="lp-section-title">
                Your workflow is connected.
                <br />
                <em>Your tools should be, too.</em>
              </h2>
            </div>
            <div>
              <p className="lp-section-lead">
                Preparation in one tool. Charts in another. Models in a
                notebook. The reasoning gets lost between them.
              </p>
              <p>
                AutoInsight AI is being built to bring data understanding,
                cleaning, analytics, machine learning and evidence-based
                research into one coherent workspace.
              </p>
            </div>
            <div className="lp-fragmented">
              <span className="lp-comparison-label">
                THE FRAGMENTED WORKFLOW
              </span>
              <div>
                <span>Spreadsheets</span>
                <span>Notebooks</span>
                <span>Charts</span>
                <span>Documents</span>
              </div>
              <p>Separate outputs. Context to reconstruct.</p>
            </div>
            <div className="lp-connected">
              <span className="lp-comparison-label">
                THE AUTOINSIGHT APPROACH
              </span>
              <div>
                <Layers3 size={24} />
                <strong>One workspace. A traceable process.</strong>
                <GitBranch size={24} />
              </div>
              <p>A shared source, an explicit method, an inspectable result.</p>
            </div>
          </div>
        </section>

        <section
          id="features"
          className="lp-section lp-container"
          aria-labelledby="features-title"
        >
          <div className="lp-section-heading" data-reveal>
            <div>
              <p className="lp-kicker">THE PLATFORM</p>
              <h2
                id="features-title"
                tabIndex={-1}
                className="lp-section-title"
              >
                Depth at every step.
                <br />
                <em>Clarity across the whole.</em>
              </h2>
            </div>
            <p>
              Six connected capabilities, designed around the way analytical
              work actually happens.
              <span className="lp-phase-note">
                Interfaces are available. Execution arrives in the phases shown
                below.
              </span>
            </p>
          </div>
          <div className="lp-capabilities">
            {capabilities.map(
              ({ title, label, icon: Icon, description, phase }, index) => (
                <article className="lp-capability" key={label} data-reveal>
                  <div className="lp-capability-top">
                    <Icon size={25} strokeWidth={1.5} />
                    <span>0{index + 1}</span>
                  </div>
                  <p className="lp-capability-label">{label}</p>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="lp-phase-tag">{phase}</span>
                </article>
              ),
            )}
          </div>
        </section>

        <section
          id="how-it-works"
          className="lp-workflow-section lp-section"
          aria-labelledby="workflow-title"
        >
          <div className="lp-container" data-reveal>
            <div className="lp-section-heading">
              <div>
                <p className="lp-kicker">FROM SOURCE TO STORY</p>
                <h2
                  id="workflow-title"
                  tabIndex={-1}
                  className="lp-section-title"
                >
                  A process you can follow.
                  <br />
                  <em>Not a black box.</em>
                </h2>
              </div>
              <p>
                A planned end-to-end workflow with human decisions and evidence
                at its core. No steps below represent a live run.
              </p>
            </div>
            <ol className="lp-workflow">
              {steps.map(({ label, icon: Icon, detail }, index) => (
                <li key={label}>
                  <div className="lp-step-marker">
                    <Icon size={23} strokeWidth={1.5} />
                    {index < steps.length - 1 && (
                      <svg
                        className="lp-step-connector"
                        viewBox="0 0 100 12"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path d="M0 6 H96 M90 1 L96 6 L90 11" />
                      </svg>
                    )}
                  </div>
                  <span className="lp-step-number">0{index + 1}</span>
                  <h3>{label}</h3>
                  <p>{detail}</p>
                </li>
              ))}
            </ol>
            <div className="lp-workflow-note">
              <GitBranch size={18} />
              <span>
                Every stage is designed to retain the dataset version, method
                and context it depends on.
              </span>
              <span>PLANNED WORKFLOW</span>
            </div>
          </div>
        </section>

        <section
          id="architecture"
          className="lp-section lp-agents-section"
          aria-labelledby="architecture-title"
        >
          <div className="lp-container">
            <div className="lp-section-heading" data-reveal>
              <div>
                <p className="lp-kicker">
                  MULTIPLE PERSPECTIVES. ONE RESEARCH QUESTION.
                </p>
                <h2
                  id="architecture-title"
                  tabIndex={-1}
                  className="lp-section-title"
                >
                  Seven roles.
                  <br />
                  <em>Shared understanding.</em>
                </h2>
              </div>
              <p>
                Each role has a defined responsibility. Select one to explore
                how the architecture is intended to work.
              </p>
            </div>
            <div className="lp-agents-grid" data-reveal>
              <div
                className="lp-role-list"
                role="group"
                aria-label="Seven logical agent roles"
              >
                {agents.map(({ title, icon: Icon }, index) => (
                  <button
                    key={title}
                    aria-pressed={selected === index}
                    aria-controls="agent-description"
                    onClick={() => setSelected(index)}
                  >
                    <span>0{index + 1}</span>
                    <Icon size={19} />
                    <strong>{title}</strong>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <div
                className="lp-agent-detail"
                id="agent-description"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="lp-agent-detail-top">
                  <span>ROLE 0{selected + 1} / 07</span>
                  <span>ARCHITECTURE PREVIEW</span>
                </div>
                <div className="lp-agent-emblem">
                  <ActiveIcon size={37} strokeWidth={1.3} />
                  <span aria-hidden="true" />
                </div>
                <p className="lp-agent-name">{active.title}</p>
                <h3>{active.verb}</h3>
                <p className="lp-agent-description">{active.description}</p>
                <dl>
                  <div>
                    <dt>Planned input</dt>
                    <dd>{active.input}</dd>
                  </div>
                  <div>
                    <dt>Intended output</dt>
                    <dd>{active.output}</dd>
                  </div>
                </dl>
                <div className="lp-orchestration">
                  <Network size={19} />
                  <p>
                    <strong>Coordinated by LangGraph</strong>
                    <span>
                      Coordination infrastructure, not an eighth agent. Roles
                      share a controlled Ollama model. Execution is planned for
                      Phase 7.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-trust lp-section" aria-labelledby="trust-title">
          <div className="lp-container">
            <div className="lp-section-heading" data-reveal>
              <div>
                <p className="lp-kicker">THOUGHTFUL FOUNDATIONS</p>
                <h2 id="trust-title" className="lp-section-title">
                  Built close to your data.
                  <br />
                  <em>Designed to be understood.</em>
                </h2>
              </div>
              <p>
                A local-first architecture with explicit boundaries.
                Privacy-conscious design choices, without promises of security
                or performance that have not been verified.
              </p>
            </div>
            <div className="lp-trust-grid" data-reveal>
              <div>
                <h3>Principles that guide the product</h3>
                <ul>
                  {[
                    [
                      'Human approval',
                      'Review meaningful data changes before execution.',
                    ],
                    [
                      'Dataset provenance',
                      'Keep original sources and derived versions connected.',
                    ],
                    [
                      'Explainable results',
                      'Distinguish computed evidence from interpretation.',
                    ],
                    [
                      'Transparent evaluation',
                      'Show baselines, held-out metrics and limitations.',
                    ],
                  ].map(([title, text]) => (
                    <li key={title}>
                      <CheckCheck size={19} />
                      <div>
                        <strong>{title}</strong>
                        <p>{text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lp-stack">
                <div className="lp-stack-heading">
                  <h3>A practical technology stack</h3>
                  <span>IMPLEMENTATION STATUS</span>
                </div>
                {[
                  ['React + TypeScript', 'Frontend interfaces', 'Available'],
                  ['FastAPI', 'Local API foundation', 'Available'],
                  [
                    'PostgreSQL + Redis',
                    'Storage & queue foundation',
                    'Available',
                  ],
                  [
                    'LangGraph + Ollama',
                    'Local agent orchestration',
                    'Planned · Phase 7',
                  ],
                  [
                    'Scikit-learn',
                    'Controlled ML pipelines',
                    'Planned · Phase 6',
                  ],
                  [
                    'Evidence-oriented reports',
                    'Sources, methods & limitations',
                    'Planned · Phase 8',
                  ],
                ].map(([name, purpose, status]) => (
                  <div className="lp-stack-row" key={name}>
                    <div>
                      <strong>{name}</strong>
                      <small>{purpose}</small>
                    </div>
                    <span className={status === 'Available' ? 'available' : ''}>
                      {status}
                    </span>
                  </div>
                ))}
                <p>
                  “Available” describes implemented foundations, not a live
                  service-health reading. Ollama feasibility has been tested;
                  application integration is still planned.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="lp-closing lp-container"
          aria-labelledby="closing-title"
          data-reveal
        >
          <div>
            <p className="lp-kicker">ASK BETTER. UNDERSTAND MORE.</p>
            <h2 id="closing-title">
              A clearer view of your data
              <br />
              <em>starts with a better workspace.</em>
            </h2>
          </div>
          <div>
            <Link className="button" to="/register">
              Get Started <ArrowUpRight size={18} />
            </Link>
            <p>
              Explore the registration interface.
              <br />
              Create an account on your local backend.
            </p>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-top">
            <div>
              <Link
                to="/"
                className="lp-brand"
                aria-label="AutoInsight AI home"
              >
                <span className="lp-brand-symbol">
                  <BarChart3 size={21} />
                </span>
                <span>
                  AutoInsight <small>AI</small>
                </span>
              </Link>
              <p>
                An Explainable Multi-Agent Platform for Automated Data Analysis
                and Machine Learning.
              </p>
            </div>
            <nav aria-label="Footer platform links">
              <span>PLATFORM</span>
              {sectionLinks}
            </nav>
            <nav aria-label="Footer workspace links">
              <span>WORKSPACE</span>
              <Link to="/login">Sign In</Link>
              <Link to="/register">Get Started</Link>
              <Link to="/status">System status</Link>
            </nav>
          </div>
          <div className="lp-footer-bottom">
            <span>
              AutoInsight AI · An educational research project in active
              development.
            </span>
            <span>Evidence before answers.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
