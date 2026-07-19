'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/product-demo/components/loader-marks/loader-marks.module.css'
import { LOADER_MARK_PATHS } from './paths'

/**
 * A quiet horizontal row of four of the ThinkingLoader's cycle shapes as
 * STATIC outline drawings - `fill='none'`, grey `--text-muted` stroke -
 * left-aligned on an even gap. Each mark carries its own hand-tuned display
 * size (see paths.ts) so the collection reads as one optical weight, and the
 * stroke uses `non-scaling-stroke` so every line renders at the same 1.2px
 * regardless of each mark's scale.
 *
 * On first scroll into view the marks DRAW themselves in, staggered left to
 * right (dash-normalized line drawing, see loader-marks.module.css); under
 * `prefers-reduced-motion` they render fully drawn immediately. Decorative.
 */
export function LoaderMarks() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDrawn(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDrawn(true)
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden='true'
      className={cn(
        'flex items-center gap-6 text-[var(--text-muted)]',
        styles.row,
        drawn && styles.drawn
      )}
    >
      {LOADER_MARK_PATHS.map(({ name, d, sizeClassName }) => (
        <svg
          key={name}
          viewBox='0 0 100 100'
          fill='none'
          stroke='currentColor'
          strokeWidth={1.2}
          strokeLinecap='round'
          strokeLinejoin='round'
          className={sizeClassName}
        >
          <path d={d} pathLength={1} vectorEffect='non-scaling-stroke' />
        </svg>
      ))}
    </div>
  )
}
