import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BarChart3, Eye, EyeOff, LockKeyhole } from 'lucide-react'

export default function Auth({ register = false }: { register?: boolean }) {
  useEffect(() => {
    document.title = `${register ? 'Create account' : 'Sign in'} · AutoInsight AI`
  }, [register])
  const [visible, setVisible] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const next: Record<string, string> = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = 'Enter a valid email address.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (register && password !== data.get('confirm'))
      next.confirm = 'Passwords must match.'
    setErrors(next)
    setMessage(
      Object.keys(next).length
        ? ''
        : 'Authentication is not connected yet (Phase 3). No credentials were sent and no session was created.',
    )
    if (Object.keys(next).length)
      (
        event.currentTarget.elements.namedItem(
          Object.keys(next)[0],
        ) as HTMLElement
      )?.focus()
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link to="/login" className="brand">
          <span className="brand-mark">
            <BarChart3 size={22} />
          </span>
          AutoInsight<span className="brand-ai">AI</span>
        </Link>
        <div className="auth-story-body">
          <p className="eyebrow">FROM DATA TO UNDERSTANDING</p>
          <h1>
            Clarity in every
            <br />
            <em>decision.</em>
          </h1>
          <p>
            An explainable workspace for your data, your questions, and the
            evidence that connects them.
          </p>
          <div
            className="analytical-motif"
            role="img"
            aria-label="Illustration of structured data becoming connected insights"
          >
            <div className="motif-grid">
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  style={
                    {
                      '--level': `${24 + ((i * 17) % 70)}%`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
            <div className="motif-caption">
              <span>DATA</span>
              <span>CONTEXT</span>
              <span>INSIGHT</span>
            </div>
          </div>
          <div className="auth-principles">
            <span>
              01 <strong>Evidence-led</strong>
            </span>
            <span>
              02 <strong>Human-approved</strong>
            </span>
            <span>
              03 <strong>Local-first</strong>
            </span>
          </div>
        </div>
        <p className="auth-footnote">
          An Explainable Multi-Agent Platform for Automated Data Analysis and
          Machine Learning.
        </p>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="badge copper">FRONTEND PREVIEW</span>
          <h2>{register ? 'Create your workspace' : 'Welcome back.'}</h2>
          <p>
            {register
              ? 'A thoughtful place to explore your data.'
              : 'Your next insight starts with a question.'}
          </p>
          <form noValidate onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@organization.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
            </label>
            {errors.email && (
              <p className="field-error" id="email-error" role="alert">
                {errors.email}
              </p>
            )}
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="At least 8 characters"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? 'password-error' : undefined
                  }
                />
                <button
                  type="button"
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {errors.password && (
              <p className="field-error" id="password-error" role="alert">
                {errors.password}
              </p>
            )}
            {register && (
              <>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-invalid={!!errors.confirm}
                    aria-describedby={
                      errors.confirm ? 'confirm-error' : undefined
                    }
                  />
                </label>
                {errors.confirm && (
                  <p className="field-error" id="confirm-error" role="alert">
                    {errors.confirm}
                  </p>
                )}
              </>
            )}
            <button className="button auth-submit" type="submit">
              {register ? 'Create account' : 'Sign in'}
              <ArrowRight size={17} />
            </button>
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
          </form>
          <p className="auth-service">
            <LockKeyhole size={15} />
            Authentication connects in Phase 3. This form validates locally
            only.
          </p>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to AutoInsight?'}{' '}
            <Link to={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <div className="auth-preview">
            <span>JUST EXPLORING?</span>
            <Link to="/dashboard">
              Open frontend preview <ArrowRight size={16} />
            </Link>
            <small>No sign-in, saved data or backend actions.</small>
          </div>
        </div>
        <p className="auth-bottom">
          Your data. Your process. Your understanding.
        </p>
      </section>
    </main>
  )
}
