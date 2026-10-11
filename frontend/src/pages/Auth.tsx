import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useSession, safeDestination } from '../app/session'
import { ApiError } from '../api/client'
import { ArrowRight, BarChart3, Eye, EyeOff, LockKeyhole } from 'lucide-react'

export default function Auth({ register = false }: { register?: boolean }) {
  useEffect(() => {
    document.title = `${register ? 'Create account' : 'Sign in'} · AutoInsight AI`
  }, [register])
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const destination = safeDestination(location.state?.from)
  useEffect(() => {
    if (session.status === 'authenticated')
      navigate(destination, { replace: true })
  }, [session.status, destination, navigate])
  const [visible, setVisible] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const display_name = String(data.get('display_name') ?? '').trim()
    const next: Record<string, string> = {}
    if (register && (!display_name || display_name.length > 80))
      next.display_name = 'Enter a display name of up to 80 characters.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      next.email = 'Enter a valid email address.'
    if (
      Array.from(password).length < (register ? 12 : 1) ||
      Array.from(password).length > 128
    )
      next.password = register
        ? 'Use between 12 and 128 characters.'
        : 'Enter your password (up to 128 characters).'
    if (register && password !== data.get('confirm'))
      next.confirm = 'Passwords must match.'
    setErrors(next)
    setMessage('')
    if (Object.keys(next).length) {
      ;(form.elements.namedItem(Object.keys(next)[0]) as HTMLElement)?.focus()
      return
    }
    setPending(true)
    try {
      await session.authenticate(register, {
        email,
        password,
        ...(register ? { display_name } : {}),
      })
      form.reset()
      navigate(destination, { replace: true })
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 422
          ? 'Check your email, display name and password length, then try again.'
          : (error as Error).message,
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link to="/" className="brand">
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
          <span className="badge copper">YOUR LOCAL WORKSPACE</span>
          <h2>{register ? 'Create your workspace' : 'Welcome back.'}</h2>
          <p>
            {register
              ? 'A thoughtful place to explore your data.'
              : 'Your next insight starts with a question.'}
          </p>
          {(location.state?.expired || session.status === 'expired') && (
            <p className="notice" role="alert">
              Your session expired. Please sign in again.
            </p>
          )}
          <form noValidate onSubmit={submit} aria-busy={pending}>
            {register && (
              <>
                <label>
                  Display name
                  <input
                    name="display_name"
                    autoComplete="name"
                    maxLength={80}
                    aria-invalid={!!errors.display_name}
                    aria-describedby={
                      errors.display_name ? 'name-error' : undefined
                    }
                  />
                </label>
                {errors.display_name && (
                  <p className="field-error" id="name-error" role="alert">
                    {errors.display_name}
                  </p>
                )}
              </>
            )}
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
                  placeholder={register ? '12–128 characters' : 'Your password'}
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
            <button
              className="button auth-submit"
              type="submit"
              disabled={pending}
            >
              {pending
                ? 'Please wait…'
                : register
                  ? 'Create account'
                  : 'Sign in'}
              <ArrowRight size={17} />
            </button>
            {message && (
              <p className="notice" role="alert">
                {message}
              </p>
            )}
          </form>
          <p className="auth-service">
            <LockKeyhole size={15} />
            Your session is managed by the local API. Passwords are never stored
            in this browser.
          </p>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to AutoInsight?'}{' '}
            <Link
              to={register ? '/login' : '/register'}
              state={{ from: destination }}
            >
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
        <p className="auth-bottom">
          Your data. Your process. Your understanding.
        </p>
      </section>
    </main>
  )
}
