'use client'

import { type CSSProperties, useEffect, useId, useRef } from 'react'
import { cn } from '@sim/emcn'
import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'

/**
 * The mark's ink: the platform's thinking-loader gradient tokens, so it follows
 * the theme. Light resolves to the locked `GOO_GRADIENT` recipe; dark lifts it
 * to the loader's light-on-dark material. Set through `style`, where `var()`
 * is unambiguous, rather than as a presentation attribute.
 */
const INK_STOP_INNER = { stopColor: 'var(--thinking-ink-inner)' } as const satisfies CSSProperties
const INK_STOP_OUTER = { stopColor: 'var(--thinking-ink-outer)' } as const satisfies CSSProperties

/**
 * The seven thinking-loader shapes in play order, each with its hold in ms.
 * Order, holds, and every timing constant below are the master's - the
 * "Sim loader wordmark" film's deterministic generator - so the footer plays
 * the same choreography frame for frame.
 */
const SHAPES = [
  ['metaballs', 2000],
  ['relay', 1300],
  ['compass', 2000],
  ['corners', 800],
  ['burst', 1300],
  ['squeeze', 1200],
  ['thinking', 2000],
] as const

type ShapeKey = (typeof SHAPES)[number][0]
type StageKey = ShapeKey | 'orb' | 'wm'

/** Crossfade between two consecutive shapes. */
const MORPH = 500
/** Liquid morph between the wordmark and the orb, on each side of the cycle. */
const MORPH_LOGO = 1200
/** Opening hold on the crisp wordmark. */
const LOGO_HOLD = 1300
/** Orb settle on either side of the shape cycle. */
const ORB_BEAT = 450
/** Closing hold on the wordmark before the loop wraps back to the opening hold. */
const HOLD_LOGO_END = 1700
const TAIL = 200
/** Goo blur while liquid (through the cycle) and while crisp (the wordmark). */
const GOO_HI = 5
const GOO_LO = 0.55
/** Post-threshold blur, about half a device pixel at the mark's largest size. */
const EDGE_SMOOTHING = 0.16
/**
 * Shapes that restart from compact when they appear and play exactly one pulse
 * of this many ms (just under a loop, so the dots reach the edge without
 * snapping back) instead of free-running on the shared clock.
 */
const LOCAL_PULSE: Partial<Record<ShapeKey, number>> = { burst: 770 }
/**
 * Longest step the clock advances per frame. A background tab or a stalled
 * frame resumes mid-choreography instead of skipping ahead.
 */
const MAX_FRAME_STEP = 100

const T_LOGO_HOLD_END = LOGO_HOLD
const T_INTRO_END = T_LOGO_HOLD_END + MORPH_LOGO
const FIRST_SHAPE_START = T_INTRO_END + ORB_BEAT

/** Lays the shapes end to end from the first shape's start. */
function buildShapeWindows(): {
  windows: Record<ShapeKey, readonly [number, number]>
  end: number
} {
  const windows: Partial<Record<ShapeKey, readonly [number, number]>> = {}
  let cursor = FIRST_SHAPE_START
  for (const [key, hold] of SHAPES) {
    windows[key] = [cursor, cursor + hold]
    cursor += hold
  }
  return { windows: windows as Record<ShapeKey, readonly [number, number]>, end: cursor }
}

const { windows: SHAPE_WINDOWS, end: SHAPES_END } = buildShapeWindows()
const T_OUTRO_START = SHAPES_END + ORB_BEAT
const T_OUTRO_END = T_OUTRO_START + MORPH_LOGO
/** One full pass: wordmark → orb → seven shapes → orb → wordmark. */
const CYCLE_MS = T_OUTRO_END + HOLD_LOGO_END + TAIL

interface Track {
  /** Period in ms. */
  dur: number
  /** Play backwards on odd iterations. */
  alt?: boolean
  /** Linear timing instead of the CSS default ease. */
  lin?: boolean
  /** `[progress, x, y]` keyframes in stage units. */
  stops: ReadonlyArray<readonly [number, number, number]>
  /** Optional `[progress, opacity]` keyframes. */
  op?: ReadonlyArray<readonly [number, number]>
}

/** Per-element motion tracks - the loader's CSS keyframes, evaluated analytically. */
const TRACKS = {
  metaballsA: {
    dur: 1000,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.9, 28, 0],
      [1, 28, 0],
    ],
  },
  metaballsB: {
    dur: 1000,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.9, -28, 0],
      [1, -28, 0],
    ],
  },
  relayBall: {
    dur: 1300,
    lin: true,
    stops: [
      [0, 0, 0],
      [1, 58, 0],
    ],
    op: [
      [0, 0],
      [0.2, 1],
      [0.78, 1],
      [1, 0],
    ],
  },
  compassMover: {
    dur: 2000,
    stops: [
      [0, 0, 0],
      [0.25, 27, 27],
      [0.5, 0, 54],
      [0.75, -27, 27],
      [1, 0, 0],
    ],
  },
  cornersA: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 46, 0],
    ],
  },
  cornersB: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, 46],
    ],
  },
  cornersC: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, -46, 0],
    ],
  },
  cornersD: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, -46],
    ],
  },
  burstUp: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, -50],
    ],
  },
  burstDown: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, 50],
    ],
  },
  burstLeft: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, -50, 0],
    ],
  },
  burstRight: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 50, 0],
    ],
  },
  squeezeBarL: {
    dur: 600,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.3, 0, 0],
      [1, 10, 0],
    ],
  },
  squeezeBarR: {
    dur: 600,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.3, 0, 0],
      [1, -10, 0],
    ],
  },
  thinkA: {
    dur: 1600,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, -20, -14],
    ],
  },
  thinkB: {
    dur: 1900,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, 22, -10],
    ],
  },
  thinkC: {
    dur: 1300,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, 2, 22],
    ],
  },
} as const satisfies Record<string, Track>

type AnimKey = keyof typeof TRACKS

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** A CSS `cubic-bezier` timing function, solved for `x` by Newton iteration. */
function cubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number
): (progress: number) => number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (progress) => {
    let t = progress
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - progress
      if (Math.abs(error) < 1e-6) break
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    return sampleY(clamp01(t))
  }
}

/** The CSS default `ease`. */
const EASE = cubicBezier(0.25, 0.1, 0.25, 1)
const LINEAR = (progress: number): number => progress

/** Hermite smoothstep from `a` to `b`. */
function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Opacity envelope: rises over `[t0, t1]`, holds, falls over `[t2, t3]`. */
function envelope(t: number, t0: number, t1: number, t2: number, t3: number): number {
  return Math.min(smooth(t0, t1, t), 1 - smooth(t2, t3, t))
}

/** The keyframe pair around `frac` and the clamped progress between them. */
function segment<T extends readonly [number, ...number[]]>(
  stops: ReadonlyArray<T>,
  frac: number
): { a: T; b: T; p: number } {
  let a = stops[0]
  let b = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (frac >= stops[i][0] && frac <= stops[i + 1][0]) {
      a = stops[i]
      b = stops[i + 1]
      break
    }
  }
  const span = b[0] - a[0] || 1
  return { a, b, p: clamp01((frac - a[0]) / span) }
}

interface Sample {
  x: number
  y: number
  opacity: number
}

/** Position and opacity of a track at `at` ms on its own clock. */
function sampleTrack(track: Track, at: number): Sample {
  const raw = at / track.dur
  const iteration = Math.floor(raw)
  let frac = raw - iteration
  if (track.alt && iteration % 2 === 1) frac = 1 - frac
  const { a, b, p } = segment(track.stops, frac)
  const eased = (track.lin ? LINEAR : EASE)(p)
  const x = a[1] + (b[1] - a[1]) * eased
  const y = a[2] + (b[2] - a[2]) * eased
  let opacity = 1
  if (track.op) {
    const o = segment(track.op, frac)
    opacity = o.a[1] + (o.b[1] - o.a[1]) * o.p
  }
  return { x, y, opacity }
}

/**
 * The wordmark's width inside the 100-unit stage - the generator's 816×392
 * mark at 0.11164, so the word sits at the same size relative to the orb.
 */
const WORDMARK_WIDTH = 91.1
const WORDMARK_SCALE = WORDMARK_WIDTH / WORDMARK_VIEW_BOX.width
const WORDMARK_HEIGHT = WORDMARK_VIEW_BOX.height * WORDMARK_SCALE
const WORDMARK_X = (100 - WORDMARK_WIDTH) / 2
const WORDMARK_Y = (100 - WORDMARK_HEIGHT) / 2
const WORDMARK_CX = WORDMARK_VIEW_BOX.width / 2
const WORDMARK_CY = WORDMARK_VIEW_BOX.height / 2

const round = (n: number): string => n.toFixed(3)

interface AnimatedNode {
  el: SVGGraphicsElement
  track: Track
  stage: ShapeKey
}

interface StageNode {
  el: SVGGElement
  key: StageKey
}

/**
 * Paints one frame of the choreography at `t` ms into the cycle by writing
 * SVG attributes directly - no React render per frame.
 */
function paintFrame(
  t: number,
  blur: SVGFEGaussianBlurElement,
  stages: StageNode[],
  anims: AnimatedNode[]
): void {
  for (const { el, track, stage } of anims) {
    const pulse = LOCAL_PULSE[stage]
    const clock =
      pulse === undefined
        ? t
        : Math.max(0, Math.min(t - (SHAPE_WINDOWS[stage][0] + MORPH / 2), pulse))
    const sample = sampleTrack(track, clock)
    el.setAttribute('transform', `translate(${round(sample.x)} ${round(sample.y)})`)
    if (track.op) el.setAttribute('opacity', sample.opacity.toFixed(4))
  }

  const introLogo = 1 - smooth(T_LOGO_HOLD_END, T_INTRO_END, t)
  const outroLogo = smooth(T_OUTRO_START, T_OUTRO_END, t)
  const logo = Math.max(introLogo, outroLogo)
  const orbIn = envelope(
    t,
    T_LOGO_HOLD_END,
    T_INTRO_END,
    FIRST_SHAPE_START - MORPH / 2,
    FIRST_SHAPE_START + MORPH / 2
  )
  const orbOut = envelope(
    t,
    SHAPES_END - MORPH / 2,
    SHAPES_END + MORPH / 2,
    T_OUTRO_START,
    T_OUTRO_END
  )
  const orb = Math.max(orbIn, orbOut)

  for (const { el, key } of stages) {
    let opacity: number
    if (key === 'wm') opacity = logo
    else if (key === 'orb') opacity = orb
    else {
      const [start, end] = SHAPE_WINDOWS[key]
      opacity = envelope(t, start - MORPH / 2, start + MORPH / 2, end - MORPH / 2, end + MORPH / 2)
    }
    el.setAttribute('opacity', opacity.toFixed(4))
  }

  const liquid = Math.min(
    smooth(T_LOGO_HOLD_END, T_INTRO_END, t),
    1 - smooth(T_OUTRO_START, T_OUTRO_END, t)
  )
  const deviation = round(GOO_LO + (GOO_HI - GOO_LO) * liquid)
  if (blur.getAttribute('stdDeviation') !== deviation) blur.setAttribute('stdDeviation', deviation)
}

interface FooterWordmarkLoopProps {
  /** Layout only - margins and alignment. The mark owns its size and chrome. */
  className?: string
}

/**
 * The footer's closing brand beat: the "Sim loader wordmark" film, live. The
 * crisp `sim` wordmark goo-melts into the thinking loader's orb, cycles through
 * all seven loader shapes with gooey morphs between them, settles back to the
 * orb, and liquid-morphs back into the wordmark - then holds and repeats.
 * Same geometry, goo filter, ink gradient, and timeline as the master
 * generator and the product's `ThinkingLoader`, drawn in one 100-unit SVG
 * stage that scales with the viewport.
 *
 * The stage reserves a 5:3 slot rather than its full square: the crisp wordmark
 * only ever needs the middle band, and the orb and shapes overflow symmetrically
 * into the beat's margins while they play, so the footer stays short enough to
 * sit on one screen together with its link directory.
 *
 * Rendering budget: the server renders the resting frame (crisp wordmark) so
 * the mark is in the HTML with zero layout shift and needs no JS to look
 * finished. The `requestAnimationFrame` loop only runs while the stage is in
 * the viewport, writes attributes straight to the SVG (no React render per
 * frame), and never starts under `prefers-reduced-motion`, where the wordmark
 * simply stays put.
 */
export function FooterWordmarkLoop({ className }: FooterWordmarkLoopProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const gooId = `fwl-goo-${id}`
  const inkId = `fwl-ink-${id}`
  const wordmarkInkId = `fwl-wm-ink-${id}`
  const clipId = `fwl-clip-${id}`
  const windowId = `fwl-window-${id}`

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const blur = svg.querySelector<SVGFEGaussianBlurElement>('[data-goo]')
    if (!blur) return

    const stages: StageNode[] = Array.from(
      svg.querySelectorAll<SVGGElement>('[data-stage]'),
      (el) => ({ el, key: el.getAttribute('data-stage') as StageKey })
    )
    const anims: AnimatedNode[] = []
    for (const el of svg.querySelectorAll<SVGGraphicsElement>('[data-anim]')) {
      const stage = el.closest('[data-stage]')?.getAttribute('data-stage') as ShapeKey | undefined
      if (stage) anims.push({ el, track: TRACKS[el.getAttribute('data-anim') as AnimKey], stage })
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame: number | null = null
    let previous: number | null = null
    let elapsed = 0
    let inView = false

    const tick = (now: number) => {
      if (previous !== null) elapsed += Math.min(now - previous, MAX_FRAME_STEP)
      previous = now
      paintFrame(elapsed % CYCLE_MS, blur, stages, anims)
      frame = requestAnimationFrame(tick)
    }
    const play = () => {
      if (frame !== null || !inView || reducedMotion?.matches) return
      previous = null
      frame = requestAnimationFrame(tick)
    }
    const pause = () => {
      if (frame === null) return
      cancelAnimationFrame(frame)
      frame = null
    }
    const onMotionPreference = () => {
      if (reducedMotion?.matches) {
        pause()
        elapsed = 0
        paintFrame(0, blur, stages, anims)
      } else {
        play()
      }
    }
    reducedMotion?.addEventListener('change', onMotionPreference)

    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'undefined') {
      inView = true
      play()
    } else {
      observer = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting
        if (inView) play()
        else pause()
      })
      observer.observe(svg)
    }

    return () => {
      pause()
      observer?.disconnect()
      reducedMotion?.removeEventListener('change', onMotionPreference)
    }
  }, [])

  return (
    <div className={cn('relative mx-auto aspect-[5/3] w-[clamp(180px,17vw,320px)]', className)}>
      <svg
        ref={svgRef}
        viewBox='0 0 100 100'
        aria-hidden='true'
        className='-translate-y-1/2 absolute inset-x-0 top-1/2 aspect-square w-full overflow-visible'
      >
        <defs>
          <filter
            id={gooId}
            x='-30%'
            y='-30%'
            width='160%'
            height='160%'
            colorInterpolationFilters='sRGB'
          >
            <feGaussianBlur data-goo='' in='SourceGraphic' stdDeviation={GOO_LO} result='blur' />
            {/* A steep threshold: the melt between shapes keeps its liquid
                merges, but every edge resolves within a pixel, so the mark
                stays crisp at the cycle's full blur. */}
            <feColorMatrix
              in='blur'
              values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 40 -19'
              result='goo'
            />
            {/* The threshold discards the rasterizer's edge coverage, so at the
                resting blur the wordmark's edge fell inside a device pixel and
                stair-stepped at the largest size. A sub-pixel blur after it
                restores ordinary anti-aliasing without touching the melt. */}
            <feGaussianBlur in='goo' stdDeviation={EDGE_SMOOTHING} />
          </filter>
          <radialGradient id={inkId} cx='0.5' cy='0.5' r='0.5'>
            <stop style={INK_STOP_INNER} />
            <stop offset='1' style={INK_STOP_OUTER} />
          </radialGradient>
          <radialGradient
            id={wordmarkInkId}
            cx='0'
            cy='0'
            r='1'
            gradientUnits='userSpaceOnUse'
            gradientTransform={`translate(${WORDMARK_CX} ${WORDMARK_CY}) rotate(90) scale(${WORDMARK_CY} ${WORDMARK_CX})`}
          >
            <stop style={INK_STOP_INNER} />
            <stop offset='1' style={INK_STOP_OUTER} />
          </radialGradient>
          <clipPath id={clipId}>
            <rect width='100' height='100' />
          </clipPath>
          <clipPath id={windowId}>
            <rect x='12.5' y='12.5' width='75' height='75' />
          </clipPath>
        </defs>

        <g
          filter={`url(#${gooId})`}
          fill={`url(#${inkId})`}
          stroke={`url(#${inkId})`}
          strokeWidth={0}
        >
          <g data-stage='metaballs' opacity={0} clipPath={`url(#${clipId})`}>
            <circle data-anim='metaballsA' cx='22' cy='50' r='16' />
            <circle data-anim='metaballsB' cx='78' cy='50' r='16' />
          </g>
          <g data-stage='relay' opacity={0} clipPath={`url(#${clipId})`}>
            <rect x='13' y='28' width='16' height='44' />
            <rect x='71' y='28' width='16' height='44' />
            <circle data-anim='relayBall' cx='21' cy='50' r='14' />
          </g>
          <g data-stage='compass' opacity={0} clipPath={`url(#${clipId})`}>
            <circle cx='50' cy='23' r='14' />
            <circle cx='23' cy='50' r='14' />
            <circle cx='77' cy='50' r='14' />
            <circle cx='50' cy='77' r='14' />
            <circle data-anim='compassMover' cx='50' cy='23' r='14' />
          </g>
          <g data-stage='corners' opacity={0} clipPath={`url(#${clipId})`}>
            <rect x='27' y='27' width='46' height='46' />
            <circle data-anim='cornersA' cx='27' cy='27' r='14' />
            <circle data-anim='cornersB' cx='73' cy='27' r='14' />
            <circle data-anim='cornersC' cx='73' cy='73' r='14' />
            <circle data-anim='cornersD' cx='27' cy='73' r='14' />
          </g>
          <g data-stage='burst' opacity={0} clipPath={`url(#${windowId})`}>
            <rect x='12.5' y='43.75' width='75' height='12.5' />
            <rect x='43.75' y='12.5' width='12.5' height='75' />
            <circle cx='50' cy='50' r='12.5' />
            <circle data-anim='burstUp' cx='50' cy='50' r='12.5' />
            <circle data-anim='burstDown' cx='50' cy='50' r='12.5' />
            <circle data-anim='burstLeft' cx='50' cy='50' r='12.5' />
            <circle data-anim='burstRight' cx='50' cy='50' r='12.5' />
          </g>
          <g data-stage='squeeze' opacity={0} clipPath={`url(#${clipId})`}>
            <path d='M 21.36 37.5 A 31.25 31.25 0 0 1 78.64 37.5' fill='none' strokeWidth='12.5' />
            <path d='M 21.36 62.5 A 31.25 31.25 0 0 0 78.64 62.5' fill='none' strokeWidth='12.5' />
            <rect data-anim='squeezeBarL' x='15' y='37.5' width='12.5' height='25' />
            <rect data-anim='squeezeBarR' x='72.5' y='37.5' width='12.5' height='25' />
          </g>
          <g data-stage='thinking' opacity={0} clipPath={`url(#${clipId})`}>
            <circle cx='50' cy='50' r='15' />
            <circle data-anim='thinkA' cx='50' cy='50' r='12' />
            <circle data-anim='thinkB' cx='50' cy='50' r='12' />
            <circle data-anim='thinkC' cx='50' cy='50' r='11' />
          </g>
          <g data-stage='orb' opacity={0}>
            <circle cx='50' cy='50' r='42' />
          </g>
          <g
            data-stage='wm'
            opacity={1}
            fill={`url(#${wordmarkInkId})`}
            transform={`translate(${round(WORDMARK_X)} ${round(WORDMARK_Y)}) scale(${WORDMARK_SCALE.toFixed(5)})`}
          >
            {WORDMARK_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}
