'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The platform heroes' shared design space - the 1280x735 "mini app" geometry
 * every hero loop lays out in (matching the homepage capture's CSS layout),
 * so each hero reads at the identical scale inside the shared demo window.
 */
export const DESIGN = { width: 1280, height: 735 } as const

/** Fade-out length before a hero loop's cycle restarts. */
export const RESET_FADE_MS = 300

/**
 * Tracks the rendered region's width via `ResizeObserver` and derives the
 * scale that fits the {@link DESIGN}-space layer to it, keeping the live
 * layer's proportions locked to the window's. Attach `regionRef` to the
 * loop's outer region and apply `transform: scale(${scale})` to the
 * design-space layer.
 */
export function useDesignScale() {
  const regionRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 40) setScale(w / DESIGN.width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { regionRef, scale }
}
