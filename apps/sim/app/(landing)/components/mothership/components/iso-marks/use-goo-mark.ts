import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * Shared rest → hover animation engine for the Sim iso goo-mark family.
 *
 * Every mark defines a `rest` and `hover` config with the same keys. On hover,
 * the hook eases each numeric key from rest toward hover (and back on leave) via
 * a fixed easing factor, driven by requestAnimationFrame. The component reads
 * `current` each frame to render its SVG.
 *
 * Locked baseline (shared across all marks): ease 0.08, spin 1.2 on hover.
 */

export type MarkState = Record<string, number>

export interface UseGooMarkOptions<T extends MarkState> {
  rest: T
  hover: T
  /** Easing factor per frame (0..1). Locked baseline = 0.08. */
  ease?: number
  /** Start in the hovered state (useful for previews). */
  forceHover?: boolean
}

export interface UseGooMarkResult<T extends MarkState> {
  /** The current tweened values - read this in render. */
  current: T
  /** Bind these to the element that should react to hover. */
  bind: {
    onMouseEnter: () => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
  }
  hovered: boolean
}

export function useGooMark<T extends MarkState>({
  rest,
  hover,
  ease = 0.08,
  forceHover = false,
}: UseGooMarkOptions<T>): UseGooMarkResult<T> {
  const [hovered, setHovered] = useState(false)
  const currentRef = useRef<T>({ ...rest })
  const [, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)
  const restRef = useRef(rest)
  const hoverRef = useRef(hover)
  const easeRef = useRef(ease)
  const activeRef = useRef(forceHover)

  restRef.current = rest
  hoverRef.current = hover
  easeRef.current = ease
  activeRef.current = forceHover || hovered

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const loop = () => {
      const target = activeRef.current ? hoverRef.current : restRef.current
      const cur = currentRef.current as MarkState
      const tgt = target as MarkState
      const e = easeRef.current
      let changed = false
      for (const k in tgt) {
        const next = prefersReduced ? tgt[k] : cur[k] + (tgt[k] - cur[k]) * e
        if (Math.abs(next - cur[k]) > 0.0001) changed = true
        cur[k] = next
      }
      if (changed) setTick((t) => (t + 1) % 1000000)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const bind = {
    onMouseEnter: useCallback(() => setHovered(true), []),
    onMouseLeave: useCallback(() => setHovered(false), []),
    onFocus: useCallback(() => setHovered(true), []),
    onBlur: useCallback(() => setHovered(false), []),
  }

  return { current: currentRef.current as T, bind, hovered }
}

/** Every mark normalizes its bounding box into this footprint, centered (50,50). */
export const TARGET = 78

/** Locked goo + gradient constants for the whole family. */
export const GOO_GRADIENT = {
  from: '#2C2C2C',
  to: '#5F5F5F',
} as const

/**
 * Rest → hover gradient recipe for the mark family. At rest the marks sit in a
 * soft light grey; on hover they deepen to the brand dark gradient. The fade is
 * driven by a `tone` key (0 → 1) tweened alongside the geometry, so color and
 * shape animate as one.
 */
export const GRADIENT_REST = { from: '#A6A6A6', to: '#C4C4C4' } as const
export const GRADIENT_HOVER = GOO_GRADIENT

function hexLerp(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16)
  const pb = Number.parseInt(b.slice(1), 16)
  const lerpChannel = (shift: number) => {
    const ca = (pa >> shift) & 255
    const cb = (pb >> shift) & 255
    return Math.round(ca + (cb - ca) * t)
  }
  const r = lerpChannel(16)
  const g = lerpChannel(8)
  const bl = lerpChannel(0)
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`
}

/** Gradient stops for a given hover tone (0 = rest/light, 1 = hover/dark). */
export function gradientForTone(tone: number): { from: string; to: string } {
  const t = Math.max(0, Math.min(1, tone))
  return {
    from: hexLerp(GRADIENT_REST.from, GRADIENT_HOVER.from, t),
    to: hexLerp(GRADIENT_REST.to, GRADIENT_HOVER.to, t),
  }
}

export type Pt = [number, number]

/** Isometric projection: 45deg in-plane rotation + vertical squash by `ky`, z is up. */
export function isoProject(x: number, y: number, z: number, ky: number): Pt {
  const ix = (x - y) * Math.SQRT1_2
  const iy = (x + y) * Math.SQRT1_2 * ky
  return [ix, iy - z]
}

/** In-plane rotation (used for spin). */
export function rotate2(x: number, y: number, rot: number): Pt {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return [x * c - y * s, x * s + y * c]
}

export type Edge = [Pt, Pt]

/**
 * Normalize a set of edges into the shared TARGET footprint and emit SVG `<path>`
 * markup. Returns the path string only; callers wrap it with defs + filter.
 */
export function edgesToPaths(edges: Edge[]): string {
  const pts = edges.flat()
  let minx = Number.POSITIVE_INFINITY
  let maxx = Number.NEGATIVE_INFINITY
  let miny = Number.POSITIVE_INFINITY
  let maxy = Number.NEGATIVE_INFINITY
  for (const [x, y] of pts) {
    if (x < minx) minx = x
    if (x > maxx) maxx = x
    if (y < miny) miny = y
    if (y > maxy) maxy = y
  }
  const w = maxx - minx || 1
  const h = maxy - miny || 1
  const scale = TARGET / Math.max(w, h)
  const ox = 50 - ((minx + maxx) / 2) * scale
  const oy = 50 - ((miny + maxy) / 2) * scale
  let d = ''
  for (const [A, B] of edges) {
    const ax = ox + A[0] * scale
    const ay = oy + A[1] * scale
    const bx = ox + B[0] * scale
    const by = oy + B[1] * scale
    d += `M${ax.toFixed(2)} ${ay.toFixed(2)} L${bx.toFixed(2)} ${by.toFixed(2)} `
  }
  return d.trim()
}

/** Stable, SSR-safe gradient + filter ids per mark instance. */
export function useMarkIds() {
  const id = useId().replace(/:/g, '')
  return { gradId: `gm-${id}-grad`, gooId: `gm-${id}-goo` }
}
