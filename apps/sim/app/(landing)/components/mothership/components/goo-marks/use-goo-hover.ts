import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * Sim abstract generative icon system — the circle / harmonograph "goo" family.
 * Built from parametric curves and overlapping circles, normalized to a fixed
 * REACH, fused by the goo filter.
 *
 * Locked recipe:
 *   viewBox 0 0 100 100, center (50,50)
 *   REACH = 40 (~80x80 footprint)
 *   stroke-width 3, round caps/joins, fill none
 *   gradient: radial userSpaceOnUse cx50 cy50 r44, #2C2C2C -> #5F5F5F
 *   goo filter: feGaussianBlur stdDeviation 1.5 + feColorMatrix alpha "20 -9"
 *
 * Hover (optional, subtle): a gentle breathe/rotate. These marks read well
 * static; hover is a light accent, enabled when `animate` (default).
 */

export const REACH = 40
export const STROKE = 3
export const GOO_FUSION = 1.5
export const TAU = Math.PI * 2

export type Pt = [number, number]

/** Sample a closed parametric curve t in [0, 2π]. */
export function sampleClosed(fn: (t: number) => Pt, steps = 720): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) pts.push(fn((i / steps) * TAU))
  return pts
}

/** Scale points so the farthest point from center reaches REACH. */
export function normalizeReach(pts: Pt[], cx = 50, cy = 50, reach = REACH): Pt[] {
  let max = 0
  for (const [x, y] of pts) {
    const r = Math.hypot(x - cx, y - cy)
    if (r > max) max = r
  }
  if (!max) return pts
  const k = reach / max
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt)
}

export function toPath(pts: Pt[], close = true): string {
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`
  if (close) d += ' Z'
  return d
}

export interface UseGooHoverOptions {
  /** Enable the subtle hover breathe/rotate. */
  animate?: boolean
  ease?: number
  forceHover?: boolean
}

export interface GooHoverResult {
  /** 0 at rest, eases toward 1 on hover. */
  amt: number
  bind: {
    onMouseEnter: () => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
  }
}

export function useGooHover({
  animate = true,
  ease = 0.1,
  forceHover = false,
}: UseGooHoverOptions = {}): GooHoverResult {
  const [hovered, setHovered] = useState(false)
  const amtRef = useRef(0)
  const [, setTick] = useState(0)
  const activeRef = useRef(forceHover)
  const easeRef = useRef(ease)
  activeRef.current = (forceHover || hovered) && animate
  easeRef.current = ease

  useEffect(() => {
    if (!animate) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const loop = () => {
      const target = activeRef.current ? 1 : 0
      const next = reduced ? target : amtRef.current + (target - amtRef.current) * easeRef.current
      if (Math.abs(next - amtRef.current) > 0.0005) {
        amtRef.current = next
        setTick((t) => (t + 1) % 1000000)
      } else if (next !== amtRef.current) {
        amtRef.current = next
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  return {
    amt: amtRef.current,
    bind: {
      onMouseEnter: useCallback(() => setHovered(true), []),
      onMouseLeave: useCallback(() => setHovered(false), []),
      onFocus: useCallback(() => setHovered(true), []),
      onBlur: useCallback(() => setHovered(false), []),
    },
  }
}

/** Stable, SSR-safe gradient + filter ids per mark instance. */
export function useGooIds() {
  const id = useId().replace(/:/g, '')
  return { gradId: `goo-${id}-grad`, gooId: `goo-${id}-goo` }
}
