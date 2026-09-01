'use client'

import { useEffect, useRef } from 'react'

const OVERLAP_PROPERTY = '--docs-footer-overlap'

/**
 * Publishes how many pixels of the viewport bottom the footer currently covers.
 *
 * The docs sidebar and its divider are pinned to the viewport, so on their own
 * they would run underneath the footer at the end of the page. Both read this as
 * their `bottom` and stop at the footer's top edge instead — the sidebar slides
 * away with the page and the divider meets the footer's border.
 *
 * It is deliberately measured against the viewport rather than the document, so
 * the value only moves while the footer is actually on screen — a content-height
 * change higher up the page cannot disturb the sidebar at all. That was the
 * regression #6301 fixed and this must not undo.
 */
export function FooterOverlapProbe() {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const root = document.documentElement
    let frame = 0
    let published = -1

    const measure = () => {
      frame = 0
      const overlap = Math.max(
        0,
        Math.round(window.innerHeight - sentinel.getBoundingClientRect().top)
      )
      if (overlap === published) return
      published = overlap
      root.style.setProperty(OVERLAP_PROPERTY, `${overlap}px`)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      root.style.removeProperty(OVERLAP_PROPERTY)
    }
  }, [])

  return (
    <div ref={sentinelRef} aria-hidden className='pointer-events-none absolute inset-x-0 top-0' />
  )
}
