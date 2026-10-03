'use client'

import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CHART_MIN_WIDTH } from '@sim/emcn'

function subscribeToDarkTheme(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function getDarkThemeSnapshot(): boolean {
  return document.documentElement.classList.contains('dark')
}

/** Server fallback until the document theme is available. */
function getServerDarkThemeSnapshot(): boolean {
  return true
}

/** Subscribe to the root theme class for SVG opacity and blend-mode values. */
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(
    subscribeToDarkTheme,
    getDarkThemeSnapshot,
    getServerDarkThemeSnapshot
  )
}

/** Observe width with a minimum plot size; null reserves the chart frame before measurement. */
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
