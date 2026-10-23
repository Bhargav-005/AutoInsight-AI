import { useEffect, useRef } from 'react'

export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = root.current
    if (!element || !window.matchMedia || !('IntersectionObserver' in window)) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const update = () => {
      frame = 0
      element.querySelectorAll<HTMLElement>('[data-scroll]').forEach(section => {
        const rect = section.getBoundingClientRect()
        const progress = Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight + rect.height)))
        section.style.setProperty('--progress', media.matches ? '1' : String(progress))
      })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = media.matches ? null : new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer?.unobserve(entry.target)
        }
      })
    }, { threshold: 0.08 })
    element.querySelectorAll<HTMLElement>('[data-reveal]').forEach(item => {
      if (observer) {
        if (item.getBoundingClientRect().top > innerHeight) item.classList.add('will-reveal')
        observer.observe(item)
      }
    })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      media.removeEventListener('change', schedule)
    }
  }, [])
  return root
}
