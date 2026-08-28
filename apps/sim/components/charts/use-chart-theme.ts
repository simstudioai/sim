'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'
import { CHART_MIN_WIDTH } from '@/components/charts/chart-geometry'

/**
 * Whether the document is in dark mode, tracked by observing the class the theme
 * toggle writes. Charts need this as a *value* rather than a CSS class because SVG
 * stroke opacity and blend mode are set per element, not by a selector.
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const element = document.documentElement
    const update = () => setIsDark(element.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(element, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

/**
 * Resolves `var(--token)` colors to concrete `rgb()` strings.
 *
 * SVG `stroke` and gradient `stopColor` do not accept a CSS variable that is defined
 * on an ancestor, so the value has to be computed once and passed literally. Callers
 * still declare colors as tokens; this is the one place that materializes them.
 */
export function useResolvedChartColors(colors: Record<string, string>): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const serialized = JSON.stringify(colors)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const resolveColor = (value: string): string => {
      if (!value.startsWith('var(')) return value
      const probe = document.createElement('div')
      probe.style.color = value
      document.body.appendChild(probe)
      const computed = window.getComputedStyle(probe).color
      probe.remove()
      return computed
    }

    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(JSON.parse(serialized) as Record<string, string>)) {
      next[key] = resolveColor(value)
    }
    setResolved(next)
  }, [serialized])

  return resolved
}

/**
 * Observed container width, floored at {@link CHART_MIN_WIDTH}. `null` until the
 * first measurement, which callers render as an empty box of the right height so the
 * chart does not reflow the page when it appears.
 */
export function useChartWidth(): [RefObject<HTMLDivElement | null>, number | null] {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.width
      if (measured && measured > 0) setWidth(Math.max(CHART_MIN_WIDTH, Math.floor(measured)))
    })
    observer.observe(element)
    const rect = element.getBoundingClientRect()
    if (rect?.width > 0) setWidth(Math.max(CHART_MIN_WIDTH, Math.floor(rect.width)))
    return () => observer.disconnect()
  }, [])

  return [containerRef, width]
}
