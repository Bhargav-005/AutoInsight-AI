import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { processSteps } from './content'

const ProcessScene = lazy(() => import('./ProcessScene'))

/** A single, scroll-linked visual that changes form as the workflow advances. */
export function ProcessStory() {
  const track = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [sceneEnabled, setSceneEnabled] = useState(false)
  const ActiveIcon = processSteps[active].icon

  useEffect(() => {
    const element = track.current
    if (!element) return
    const media = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null
    const reduced = media?.('(prefers-reduced-motion: reduce)')
    const sceneMedia = media?.('(min-width: 768px) and (prefers-reduced-motion: no-preference)')
    let frame = 0
    const setScene = () => setSceneEnabled(sceneMedia?.matches ?? false)
    const update = () => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const range = Math.max(1, element.offsetHeight - innerHeight)
      const progress = Math.max(0, Math.min(1, -rect.top / range))
      const stage = Math.min(processSteps.length - 1, Math.round(progress * (processSteps.length - 1)))
      element.dataset.progress = progress.toFixed(4)
      element.style.setProperty('--step-progress', String(progress))
      element.dispatchEvent(new CustomEvent<number>('processprogress', { detail: progress }))
      setActive(previous => previous === stage ? previous : stage)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    reduced?.addEventListener('change', schedule)
    sceneMedia?.addEventListener('change', setScene)
    setScene()
    update()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      reduced?.removeEventListener('change', schedule)
      sceneMedia?.removeEventListener('change', setScene)
    }
  }, [])

  const jumpTo = (index: number) => {
    const element = track.current
    if (!element) return
    const range = Math.max(0, element.offsetHeight - innerHeight)
    const top = element.getBoundingClientRect().top + scrollY + range * (index / (processSteps.length - 1))
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' })
  }

  return <div className="lp-process-track" ref={track} data-active={active} data-progress="0" style={{ '--step-progress': '0' } as CSSProperties}>
    <div className="lp-process-stage">
      <div className="lp-process-story">
        <div className="lp-process-copy" aria-live="polite" aria-atomic="true">
          <p className="lp-process-overline">THE TRACEABLE WORKFLOW <span>0{active + 1} / 07</span></p>
          <h3>{processSteps[active].title}</h3>
          <p>{processSteps[active].description}.</p>
          <span className="lp-process-current"><ActiveIcon size={17}/>{processSteps[active].title}</span>
        </div>
        <div className="lp-process-art" aria-hidden="true">{sceneEnabled ? <Suspense fallback={<div className="lp-process-scene-loading"/>}><ProcessScene track={track}/></Suspense> : <div className="lp-process-fallback"><i/><i/><i/><span>Data, shaped by every step</span></div>}</div>
        <div className="lp-process-navigation" role="group" aria-label="Explore workflow stages">
          <div className="lp-process-progress" aria-hidden="true"><span/></div>
          {processSteps.map(({ title }, index) => <button key={title} type="button" aria-current={index === active ? 'step' : undefined} aria-label={`Go to step ${index + 1}: ${title}`} onClick={() => jumpTo(index)}>
            <span className="lp-process-nav-number">0{index + 1}</span><span className="lp-process-nav-name">{title}</span>
          </button>)}
        </div>
      </div>
      <p className="lp-process-note">An illustrated user workflow. Agent execution adapts to the task.</p>
    </div>
    <ol className="lp-process-static" aria-label="All seven workflow stages">{processSteps.map(({ title, icon: Icon, description }, index) => <li key={title}><span>0{index + 1}</span><Icon/><h3>{title}</h3><p>{description}</p></li>)}</ol>
  </div>
}
