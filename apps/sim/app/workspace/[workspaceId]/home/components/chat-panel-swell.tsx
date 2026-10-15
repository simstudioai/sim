'use client'

import { useLayoutEffect, useRef } from 'react'
import { cn } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'

const R_MAX = 12
const PEAK = 28
const SHOULDER = (PEAK * 20) / 24
/** Steepest side, reached when the control is narrow, such as just its icon. */
const SHOULDER_STEEP = 10
/** A narrow swell's sides steepen with its width, so an icon-sized swell rises sharply. */
const SHOULDER_PER_PLATEAU = 0.5
const PEAK_COLLAPSED = 24
const SHOULDER_COLLAPSED = 14
/** How far below the card's top the collapsed swell rests on its left edge. */
const COLLAPSED_DROP = 56
const CORNER_SMOOTHING = 0.25
/** The control's slot diagonals run 20px across 24px, so they sit this far inside the taper. */
const SLOT_GAP = 2.6
const PLATEAU_INSET = (20 * (PEAK - 2)) / 24 - SLOT_GAP
/** The icon's centre from the collapsed label's leading edge: its padding plus half the glyph. */
const LABEL_ICON_CENTER = 18
/** Samples sit on a fixed grid along the perimeter, so a moving swell never reshuffles its vertices. */
const SAMPLE_STEP = 1
const SETTLED_FRAMES = 3
/** The prototype's spring: near-critically damped, so it eases in and settles without overshoot. */
const SPRING_STIFFNESS = 300
const SPRING_DAMPING = 32
const SPRING_REST = 1e-4
const MAX_FRAME_SECONDS = 1 / 30
/** On collapse the swell rides the shrinking card this long before sliding toward the corner. */
const COLLAPSE_TRAVEL_DELAY_MS = 60

interface Spring {
  x: number
  v: number
}

/** Advances the spring one frame toward `target`; returns whether it is still moving. */
function stepSpring(spring: Spring, target: number, dt: number): boolean {
  spring.v += (SPRING_STIFFNESS * (target - spring.x) - SPRING_DAMPING * spring.v) * dt
  spring.x += spring.v * dt
  if (Math.abs(target - spring.x) < SPRING_REST && Math.abs(spring.v) < SPRING_REST) {
    spring.x = target
    spring.v = 0
    return false
  }
  return true
}

interface PerimeterPoint {
  x: number
  y: number
  nx: number
  ny: number
}

interface PerimeterSegment {
  len: number
  at: (u: number) => PerimeterPoint
}

/** Rounded-rect perimeter, clockwise from the bottom of the left edge. */
function perimeter(x0: number, y0: number, x1: number, y1: number, r: number) {
  const h = y1 - y0
  const w = x1 - x0
  const arc = (cx: number, cy: number, th0: number): PerimeterSegment => ({
    len: (Math.PI * r) / 2,
    at: (u) => {
      const th = th0 + (r > 0 ? u / r : 0)
      const c = Math.cos(th)
      const s = Math.sin(th)
      return { x: cx + r * c, y: cy + r * s, nx: c, ny: s }
    },
  })
  const segments: PerimeterSegment[] = [
    { len: h - 2 * r, at: (u) => ({ x: x0, y: y1 - r - u, nx: -1, ny: 0 }) },
    arc(x0 + r, y0 + r, Math.PI),
    { len: w - 2 * r, at: (u) => ({ x: x0 + r + u, y: y0, nx: 0, ny: -1 }) },
    arc(x1 - r, y0 + r, 1.5 * Math.PI),
    { len: h - 2 * r, at: (u) => ({ x: x1, y: y0 + r + u, nx: 1, ny: 0 }) },
    arc(x1 - r, y1 - r, 0),
    { len: w - 2 * r, at: (u) => ({ x: x1 - r - u, y: y1, nx: 0, ny: 1 }) },
    arc(x0 + r, y1 - r, 0.5 * Math.PI),
  ]
  return (distance: number): PerimeterPoint => {
    let s = distance
    for (const segment of segments) {
      if (s <= segment.len) return segment.at(Math.max(0, s))
      s -= segment.len
    }
    const last = segments[segments.length - 1]
    return last.at(last.len)
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (n: number) => n * n * (3 - 2 * n)

function smoothMin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** A flat plateau with straight shoulders at the slots' own slope, its corners smoothed. */
function bump(distance: number, plateau: number, shoulder: number) {
  const v = 1 - (Math.abs(distance) - plateau / 2) / shoulder
  return -smoothMin(-smoothMin(v, 1, CORNER_SMOOTHING), 0, CORNER_SMOOTHING)
}

function relativeRect(el: Element, origin: DOMRect) {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left - origin.left,
    right: rect.right - origin.left,
    top: rect.top - origin.top,
    bottom: rect.bottom - origin.top,
    width: rect.width,
  }
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`Swell is missing ${selector}`)
  return el
}

interface SwellElements {
  layout: HTMLElement
  panel: HTMLElement
  path: SVGPathElement
  label: HTMLElement
  icon: HTMLElement
}

/**
 * Opens the panel to `progress` and lays the swell out against the card that results, `travel` of
 * the way from its collapsed rest to the control. The panel and card size themselves from
 * `--swell-progress`, so one write moves both, then the swell is measured from the laid-out card
 * and can never drift from it.
 */
function drawSwell(
  { layout, panel, path, label, icon }: SwellElements,
  progress: number,
  travel: number
): string {
  const card = requireElement<HTMLElement>(panel, '[data-swell-card]')
  const control = requireElement<HTMLElement>(panel, '[data-swell-control]')
  const dock = requireElement<HTMLElement>(panel, '[data-swell-dock]')
  const t = clamp01(travel)
  panel.style.setProperty('--swell-progress', String(progress))
  panel.style.setProperty('--swell-edge', String(clamp01(progress * 8)))

  const origin = layout.getBoundingClientRect()
  const cardRect = relativeRect(card, origin)
  const controlRect = relativeRect(control, origin)
  const dockRect = relativeRect(dock, origin)
  const x0 = cardRect.left
  const x1 = Math.max(x0, cardRect.right)
  const y0 = cardRect.top
  const y1 = cardRect.bottom
  const r = Math.min(R_MAX, (x1 - x0) / 2, (y1 - y0) / 2)
  const at = perimeter(x0, y0, x1, y1, r)

  const leftLength = y1 - y0 - 2 * r
  // The base stays as wide as the slots' own taper; steeper sides widen the plateau instead.
  const slotPlateau = controlRect.width - 2 * PLATEAU_INSET
  const openShoulder = Math.min(
    SHOULDER,
    Math.max(SHOULDER_STEEP, slotPlateau * SHOULDER_PER_PLATEAU)
  )
  const plateau = lerp(label.offsetWidth + 4, slotPlateau + 2 * (SHOULDER - openShoulder), t)
  const peak = lerp(PEAK_COLLAPSED, PEAK, t)
  const shoulder = lerp(SHOULDER_COLLAPSED, openShoulder, t)
  const restingCenter = Math.max(0, leftLength - COLLAPSED_DROP)
  const topStart = leftLength + (Math.PI * r) / 2
  // Kept on the top edge while the swell lingers on a card that is shrinking out from under it.
  const controlCenter =
    topStart +
    Math.min((controlRect.left + controlRect.right) / 2 - (x0 + r), Math.max(0, x1 - x0 - 2 * r))
  const center = lerp(restingCenter, controlCenter, t)

  const start = Math.floor((center - plateau / 2 - shoulder - 1) / SAMPLE_STEP) * SAMPLE_STEP
  const end = Math.ceil((center + plateau / 2 + shoulder + 1) / SAMPLE_STEP) * SAMPLE_STEP
  const outer: string[] = []
  const inner: string[] = []
  for (let step = 0; start + step * SAMPLE_STEP <= end; step++) {
    const distance = start + step * SAMPLE_STEP
    const point = at(distance)
    // One pixel inside the card's edge, so its border hides the fill's antialiasing.
    const offset = (peak + 1) * bump(distance - center, plateau, shoulder) - 1
    outer.push(
      `${(point.x + point.nx * offset).toFixed(2)},${(point.y + point.ny * offset).toFixed(2)}`
    )
    inner.push(`${(point.x - point.nx).toFixed(2)},${(point.y - point.ny).toFixed(2)}`)
  }
  const outline = `M${outer.join('L')}L${inner.reverse().join('L')}Z`
  path.setAttribute('d', outline)

  const base = at(center)
  let rotation = (Math.atan2(base.ny, base.nx) * 180) / Math.PI + 90
  if (rotation > 180) rotation -= 360
  const labelX = base.x + (base.nx * peak) / 2
  const labelY = base.y + (base.ny * peak) / 2
  label.style.transform = `translate(${labelX}px,${labelY}px) translate(-50%,-50%) rotate(${rotation}deg)`
  label.toggleAttribute('data-hidden', t > 0.2)
  label.inert = t > 0.2

  // Carried at the swell's trailing end, where it sits in the collapsed label, then docked.
  const carry = at(center - plateau / 2 + LABEL_ICON_CENTER)
  const drop = smoothstep(clamp01((t - 0.6) / 0.4))
  const iconX = lerp(carry.x + (carry.nx * peak) / 2, (dockRect.left + dockRect.right) / 2, drop)
  const iconY = lerp(carry.y + (carry.ny * peak) / 2, (dockRect.top + dockRect.bottom) / 2, drop)
  icon.style.transform = `translate(${iconX}px,${iconY}px) translate(-50%,-50%) rotate(${rotation * (1 - drop)}deg)`
  icon.toggleAttribute('data-docked', drop > 0.5)
  icon.toggleAttribute('data-hidden', t === 1)

  panel.toggleAttribute('data-swell-hidden', panel.inert || t <= 0.9)
  panel.toggleAttribute('data-swell-docked', t === 1)
  panel.style.setProperty('--swell-content-opacity', String(clamp01((progress - 0.6) * 2.5)))
  return outline
}

interface ChatPanelSwellProps {
  label: string
  toggleLabel: string
  /** Whether a tab, rather than the control's own view, fills the panel. */
  idle: boolean
  collapsed: boolean
  /** Jumps to the collapsed state instead of animating, such as when the chat changes. */
  instant: boolean
  activityCount: number
  onExpand: () => void
}

/**
 * The swell that carries the panel's navigation control on the card's top edge and, collapsed,
 * rests on its left edge as the expand tab. Rendered as a sibling of `[data-mothership-panel]`,
 * which must contain `[data-swell-card]`, `[data-swell-control]`, and `[data-swell-dock]`.
 */
export function ChatPanelSwell({
  label,
  toggleLabel,
  idle,
  collapsed,
  instant,
  activityCount,
  onExpand,
}: ChatPanelSwellProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)

  const springRef = useRef<Spring>({ x: collapsed ? 0 : 1, v: 0 })
  const travelRef = useRef<Spring>({ x: collapsed ? 0 : 1, v: 0 })
  const targetRef = useRef(collapsed ? 0 : 1)
  const collapsedAtRef = useRef(0)
  const kickRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const layout = layerRef.current?.parentElement
    const path = pathRef.current
    const label = labelRef.current
    const icon = iconRef.current
    if (!layout || !path || !label || !icon) throw new Error('Swell layer is not mounted')
    const panel = requireElement<HTMLElement>(layout, '[data-mothership-panel]')
    const elements = { layout, panel, path, label, icon }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const spring = springRef.current
    const travel = travelRef.current

    let frame = 0
    let still = 0
    let lastTime = 0
    let lastOutline = ''
    const tick = (time: number) => {
      frame = 0
      const dt = lastTime ? Math.min(MAX_FRAME_SECONDS, (time - lastTime) / 1000) : 1 / 60
      lastTime = time
      const target = targetRef.current
      const holding = target === 0 && time - collapsedAtRef.current < COLLAPSE_TRAVEL_DELAY_MS
      let moving = false
      if (reducedMotion.matches) {
        spring.x = travel.x = target
        spring.v = travel.v = 0
      } else {
        const panelMoving = stepSpring(spring, target, dt)
        const travelMoving = stepSpring(travel, holding ? 1 : target, dt)
        moving = panelMoving || travelMoving || holding
      }
      const outline = drawSwell(elements, spring.x, travel.x)
      still = moving || outline !== lastOutline ? 0 : still + 1
      lastOutline = outline
      if (still < SETTLED_FRAMES) frame = requestAnimationFrame(tick)
      else lastTime = 0
    }
    const kick = () => {
      still = 0
      frame ||= requestAnimationFrame(tick)
    }
    kickRef.current = kick

    drawSwell(elements, spring.x, travel.x)
    // Observers run after layout and before paint, so drawing here keeps the swell on the card
    // in the same frame as a resize instead of one behind it.
    const observer = new ResizeObserver(() => {
      drawSwell(elements, spring.x, travel.x)
      kick()
    })
    observer.observe(layout)
    observer.observe(panel)
    observer.observe(label)
    observer.observe(requireElement(panel, '[data-swell-control]'))
    return () => {
      kickRef.current = null
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useLayoutEffect(() => {
    targetRef.current = collapsed ? 0 : 1
    if (collapsed) collapsedAtRef.current = performance.now()
    if (instant) {
      for (const spring of [springRef.current, travelRef.current]) {
        spring.x = targetRef.current
        spring.v = 0
      }
    }
    kickRef.current?.()
  }, [collapsed, instant])

  return (
    <div
      ref={layerRef}
      className={cn(
        'pointer-events-none absolute inset-0 max-md:hidden',
        idle ? '[--swell-fill:var(--surface-6)]' : '[--swell-fill:var(--text-body)]'
      )}
    >
      <svg aria-hidden='true' className='absolute inset-0 z-[5] size-full overflow-visible'>
        <path ref={pathRef} className='fill-[var(--swell-fill)] transition-[fill] duration-200' />
      </svg>
      <button
        ref={labelRef}
        type='button'
        onClick={onExpand}
        aria-label={toggleLabel}
        className='pointer-events-auto absolute top-0 left-0 z-30 flex h-[26px] items-center gap-1.5 whitespace-nowrap px-2 font-medium text-[var(--text-inverse)] text-small transition-opacity duration-150 data-[hidden]:pointer-events-none data-[hidden]:opacity-0'
      >
        <PanelLeft aria-hidden='true' className='-scale-x-100 invisible size-[16px]' />
        {label}
        {activityCount > 0 && (
          <span aria-hidden='true' className='size-1.5 rounded-full bg-[var(--brand-blue)]' />
        )}
      </button>
      <span
        ref={iconRef}
        aria-hidden='true'
        className='absolute top-0 left-0 z-30 flex text-[var(--text-inverse)] transition-colors duration-200 data-[hidden]:invisible data-[docked]:text-[var(--text-icon)]'
      >
        <PanelLeft className='-scale-x-100 size-[16px]' />
      </span>
    </div>
  )
}
