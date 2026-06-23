'use client'

import { type CSSProperties, type ReactNode, useEffect, useId, useState } from 'react'
import styles from '@/components/emcn/components/thinking-loader/thinking-loader.module.css'
import { cn } from '@/lib/core/utils/cn'

const VARIANTS = [
  'metaballs',
  'relay',
  'corners',
  'burst',
  'compass',
  'squeeze',
  'thinking',
  'orb',
] as const

export type ThinkingLoaderVariant = (typeof VARIANTS)[number]

/**
 * Shapes used in the random morph cycle. `orb` (the solid terminal circle) is
 * excluded — it is only reachable by pinning `variant='orb'` or via `settle`,
 * so the cycle never lands on it mid-stream.
 */
const CYCLE_VARIANTS = VARIANTS.filter((v) => v !== 'orb')

/**
 * Deterministic integer hash — turns a step index into a spread-out pseudo-
 * random number. Used to pick both the shape and its hold time per step, so the
 * order and pacing look unpredictable (any shape can follow any other, some
 * linger, some pass quickly) while staying a pure function of the clock — every
 * loader instance lands on the same shape at the same time.
 */
function hashStep(n: number): number {
  let x = n | 0
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b)
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b)
  return ((x >>> 16) ^ x) >>> 0
}

/**
 * Common multiple of every shape animation period (800/1000/1200/2000ms,
 * alternates doubled) — the wall-clock modulus for the shared negative
 * animation-delay that phase-locks instances mounted at different times.
 */
const SYNC_PERIOD_MS = 12_000

/**
 * A super-cycle of steps, each holding a pseudo-random shape for a pseudo-random
 * duration (≈1.1–2.6s), so the morph pacing feels natural — some shapes linger,
 * some pass quickly — instead of a metronome. Deterministic, so instances stay
 * in lockstep; long enough not to read as a loop.
 */
const CYCLE_STEPS = 16
const STEP_MIN_MS = 1100
const STEP_RANGE_MS = 1500
const STEP_DURATIONS = Array.from(
  { length: CYCLE_STEPS },
  (_, i) => STEP_MIN_MS + (hashStep(i + 1000) % STEP_RANGE_MS)
)
const SUPER_PERIOD_MS = STEP_DURATIONS.reduce((sum, d) => sum + d, 0)

/** The shape for a given step — pseudo-random, never an immediate repeat. */
function variantForStep(i: number): ThinkingLoaderVariant {
  const idx = hashStep(i) % CYCLE_VARIANTS.length
  const prevIdx = hashStep((i - 1 + CYCLE_STEPS) % CYCLE_STEPS) % CYCLE_VARIANTS.length
  return CYCLE_VARIANTS[idx === prevIdx ? (idx + 1) % CYCLE_VARIANTS.length : idx]
}

/**
 * The shape the shared timeline is on right now, and how long until the next.
 * Walks the super-cycle's varied step durations — a pure function of the wall
 * clock, so instances stay in lockstep.
 */
function variantAtNow(): { variant: ThinkingLoaderVariant; msUntilNext: number } {
  let t = Date.now() % SUPER_PERIOD_MS
  for (let i = 0; i < CYCLE_STEPS; i++) {
    if (t < STEP_DURATIONS[i]) {
      return { variant: variantForStep(i), msUntilNext: STEP_DURATIONS[i] - t }
    }
    t -= STEP_DURATIONS[i]
  }
  return { variant: variantForStep(0), msUntilNext: STEP_DURATIONS[0] }
}

/**
 * Ink shapes per variant, authored in the shared 100x100 viewBox.
 * Geometry mirrors the intrinsic CSS loaders these were adapted from,
 * contain-fit to the canvas. Animations live in the CSS module.
 */
const VARIANT_SHAPES: Record<ThinkingLoaderVariant, ReactNode> = {
  metaballs: (
    <>
      <circle className={styles.metaballsA} cx='22' cy='50' r='16' />
      <circle className={styles.metaballsB} cx='78' cy='50' r='16' />
    </>
  ),
  relay: (
    <>
      <rect x='13' y='28' width='16' height='44' />
      <rect x='71' y='28' width='16' height='44' />
      <circle className={styles.relayBall} cx='21' cy='50' r='14' />
    </>
  ),
  corners: (
    <>
      <rect x='27' y='27' width='46' height='46' />
      <circle className={styles.cornersA} cx='27' cy='27' r='14' />
      <circle className={styles.cornersB} cx='73' cy='27' r='14' />
      <circle className={styles.cornersC} cx='73' cy='73' r='14' />
      <circle className={styles.cornersD} cx='27' cy='73' r='14' />
    </>
  ),
  // burst (Thinking) — four dots fling out of a center cross and are swallowed
  // at the window edge, then fire again: the Core churning.
  burst: (
    <>
      <rect x='12.5' y='43.75' width='75' height='12.5' />
      <rect x='43.75' y='12.5' width='12.5' height='75' />
      <circle cx='50' cy='50' r='12.5' />
      <circle className={styles.burstUp} cx='50' cy='50' r='12.5' />
      <circle className={styles.burstDown} cx='50' cy='50' r='12.5' />
      <circle className={styles.burstLeft} cx='50' cy='50' r='12.5' />
      <circle className={styles.burstRight} cx='50' cy='50' r='12.5' />
    </>
  ),
  compass: (
    <>
      <circle cx='50' cy='23' r='14' />
      <circle cx='23' cy='50' r='14' />
      <circle cx='77' cy='50' r='14' />
      <circle cx='50' cy='77' r='14' />
      <circle className={styles.compassMover} cx='50' cy='23' r='14' />
    </>
  ),
  squeeze: (
    <>
      <path
        d='M 21.36 37.5 A 31.25 31.25 0 0 1 78.64 37.5'
        fill='none'
        stroke='currentColor'
        strokeWidth='12.5'
      />
      <path
        d='M 21.36 62.5 A 31.25 31.25 0 0 0 78.64 62.5'
        fill='none'
        stroke='currentColor'
        strokeWidth='12.5'
      />
      <rect className={styles.squeezeBarL} x='15' y='37.5' width='12.5' height='25' />
      <rect className={styles.squeezeBarR} x='72.5' y='37.5' width='12.5' height='25' />
    </>
  ),
  // thinking — a core with small blobs drifting out and back on offset timings:
  // a restless thought-cloud that never quite resolves. The Core deliberating.
  thinking: (
    <>
      <circle cx='50' cy='50' r='15' />
      <circle className={styles.thinkA} cx='50' cy='50' r='12' />
      <circle className={styles.thinkB} cx='50' cy='50' r='12' />
      <circle className={styles.thinkC} cx='50' cy='50' r='11' />
    </>
  ),
  // orb — a single solid disc that nearly fills the frame. Not part of the
  // random cycle; the loader settles here so it can hand off to a real circular
  // button (e.g. a send button) without a visible shape pop.
  orb: <circle cx='50' cy='50' r='42' />,
}

/**
 * World-aligned status phrase per shape (used when `phase` is set). Each phrase
 * names what the shape represents in the Sim world, so the words on screen always
 * match the loader. Keys are the shape names; the comment is the world concept.
 */
const VARIANT_PHRASE: Record<ThinkingLoaderVariant, string> = {
  corners: 'Orchestrating…', // Mothership — the Core directing the work
  squeeze: 'Working…', // Pod — one agent on a task
  compass: 'In formation…', // Formation — many Pods in parallel
  metaballs: 'Dispatching…', // Dispatch — sending work out
  relay: 'Returning…', // Return — work coming back, consolidated
  burst: 'Thinking…', // Thinking — the Core deliberating
  thinking: 'Standing by…', // Waiting · Sentinel — holding for a condition
  orb: 'Ready', // Orb — settled, ready to act
}

export interface ThinkingLoaderProps {
  /** Pin one pattern. When omitted, the loader morphs between all patterns at random. */
  variant?: ThinkingLoaderVariant
  /**
   * When cycling, open on this pattern (held one beat) before joining the
   * shared morph timeline. Use `'corners'` (the Mothership shape) to always
   * begin on the Core. Ignored when `variant` pins a single pattern.
   */
  startVariant?: ThinkingLoaderVariant
  /**
   * Stop cycling and morph to the solid `orb` disc — the loader's terminal
   * resting shape. The goo filter melts the current shape into the orb (no hard
   * swap), so it can hand off to a real circular element underneath it. Ignored
   * when `variant` pins a single pattern.
   */
  settle?: boolean
  /** Rendered square size in px. Defaults to 20. */
  size?: number
  /** Optional status text (e.g. "Thinking…") rendered beside the goo with a shimmer sweep. */
  label?: string
  /**
   * Show a world-aligned status phrase that matches the current shape — e.g.
   * "Dispatching…" under the Dispatch shape — updating as the loader morphs.
   * Overrides `label`.
   */
  phase?: boolean
  /**
   * Phrase/label font size as a fraction of `size`. Defaults to `0.7`. Lower it
   * when the loader is shown scaled up (e.g. a zoomed hero shot) so the phrase
   * doesn't read oversized next to the glyph.
   */
  labelRatio?: number
  /** Layout-only classes (margins, alignment). The loader owns its chrome. */
  className?: string
  /**
   * Escape hatch for the ink material: merged onto the SVG, so a caller can
   * override the gradient/glow CSS vars (`--tl-grad-inner`, `--tl-grad-outer`,
   * `--tl-glow`) to match a surface it hands off to. Inline, so it beats the
   * module defaults. Use sparingly — the loader owns its look by default.
   */
  style?: CSSProperties
}

/**
 * Gooey mono thinking indicator shown wherever chat is working.
 * Ink is near-black on light surfaces and off-white on dark surfaces.
 *
 * The goo filter operates on the alpha channel of transparent SVG shapes,
 * so the loader needs no backdrop and composites on any background. All
 * patterns share one filtered group, so the default cycling mode melts one
 * pattern into the next instead of hard-swapping.
 *
 * @example
 * ```tsx
 * <ThinkingLoader label='Thinking…' />
 * ```
 */
export function ThinkingLoader({
  variant,
  startVariant,
  settle = false,
  size = 20,
  label,
  phase,
  labelRatio = 0.7,
  className,
  style,
}: ThinkingLoaderProps) {
  // useId emits colons, which break url(#...) filter references — strip them.
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const filterId = `tl-goo-${id}`
  const clipId = `tl-clip-${id}`
  const windowClipId = `tl-window-${id}`
  const gradientId = `tl-grad-${id}`
  const [cycleVariant, setCycleVariant] = useState<ThinkingLoaderVariant>(
    startVariant ?? 'metaballs'
  )
  const cycling = variant === undefined

  useEffect(() => {
    if (!cycling) return
    // Settle: stop the cycle and melt to the terminal orb (goo handles the morph).
    if (settle) {
      setCycleVariant('orb')
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // When a startVariant is given, hold it for one min-step so the cycle always
    // opens on that shape, then join the shared wall-clock morph timeline.
    let opened = startVariant === undefined
    let timeout: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!opened) {
        opened = true
        setCycleVariant(startVariant as ThinkingLoaderVariant)
        timeout = setTimeout(tick, STEP_MIN_MS)
        return
      }
      const { variant: next, msUntilNext } = variantAtNow()
      setCycleVariant(next)
      timeout = setTimeout(tick, msUntilNext)
    }
    tick()
    return () => clearTimeout(timeout)
  }, [cycling, startVariant, settle])

  // Phase-lock the CSS animations to the wall clock (set after mount so
  // server and client markup agree). All instances share the same negative
  // delay modulus, so their keyframes line up regardless of mount time.
  const [syncDelay, setSyncDelay] = useState<string | undefined>(undefined)
  useEffect(() => {
    setSyncDelay(`-${Date.now() % SYNC_PERIOD_MS}ms`)
  }, [])

  const shown = variant ?? cycleVariant
  // `phase` shows the world phrase for the shape on screen; otherwise the
  // caller's static label (if any). Cycling, it updates as the shape morphs.
  const displayLabel = phase ? VARIANT_PHRASE[shown] : label

  // Crossfade the phrase when it changes: the outgoing phrase rises and fades
  // out while the incoming one rises and fades in, so they rotate smoothly
  // instead of snapping. The shimmer keeps running on the text underneath.
  const [shownLabel, setShownLabel] = useState(displayLabel)
  const [exitingLabel, setExitingLabel] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (displayLabel === shownLabel) return
    setExitingLabel(shownLabel)
    setShownLabel(displayLabel)
  }, [displayLabel, shownLabel])
  useEffect(() => {
    if (!exitingLabel) return
    const timeout = setTimeout(() => setExitingLabel(undefined), 420)
    return () => clearTimeout(timeout)
  }, [exitingLabel])

  const stages = cycling ? VARIANTS : [shown]

  const loader = (
    <svg
      role={displayLabel ? undefined : 'status'}
      aria-label={displayLabel ? undefined : 'Thinking'}
      aria-hidden={displayLabel ? true : undefined}
      viewBox='0 0 100 100'
      width={size}
      height={size}
      className={cn(styles.frame, !displayLabel && className)}
      style={{
        ...(syncDelay ? ({ '--tl-sync': syncDelay } as CSSProperties) : {}),
        ...style,
      }}
    >
      <defs>
        {/* sRGB so the radial gradient fill keeps its authored midtones
            through the blur (linearRGB would wash the gradient out). The goo
            crush runs first; the inner glow then rides the merged silhouette's
            edge — a soft white inset, per the Figma loader spec. */}
        <filter
          id={filterId}
          x='-30%'
          y='-30%'
          width='160%'
          height='160%'
          colorInterpolationFilters='sRGB'
        >
          <feGaussianBlur in='SourceGraphic' stdDeviation='5' result='blur' />
          <feColorMatrix
            in='blur'
            values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9'
            result='goo'
          />
          {/* Inner shadow from the goo silhouette's alpha (Figma technique:
              blur the alpha, subtract it from itself to leave an inner ring,
              tint white). stdDeviation 4.86 = the spec's 3.5 scaled 72→100. */}
          <feColorMatrix
            in='goo'
            type='matrix'
            values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 127 0'
            result='gooAlpha'
          />
          <feGaussianBlur in='gooAlpha' stdDeviation='4.86' result='innerBlur' />
          <feComposite
            in='innerBlur'
            in2='gooAlpha'
            operator='arithmetic'
            k2='-1'
            k3='1'
            result='innerMask'
          />
          {/* Glow color + per-theme opacity ride a CSS var (light 0.6 / dark
              0.9) so one filter serves both themes. */}
          <feFlood className={styles.glow} result='glowColor' />
          <feComposite in='glowColor' in2='innerMask' operator='in' result='glow' />
          <feMerge>
            <feMergeNode in='goo' />
            <feMergeNode in='glow' />
          </feMerge>
        </filter>
        {/* Radial gradient (center → edge), theme stops via CSS vars. Matches
            the Figma loader: light #4F4F4F→#6F6F6F, dark #A7A7A7→#D6D6D6.
            objectBoundingBox (default units) so EACH blob is shaded on its own
            box — Figma fits the gradient per shape, so small/offset dots read
            glossy (center dark, edge light) instead of flat. */}
        <radialGradient id={gradientId} cx='0.5' cy='0.5' r='0.5'>
          <stop className={styles.gradInner} />
          <stop offset='1' className={styles.gradOuter} />
        </radialGradient>
        {/* Shapes clip BEFORE the goo filter, so anything exiting the frame
            melts into the edge instead of getting a hard post-filter cut. */}
        <clipPath id={clipId}>
          <rect width='100' height='100' />
        </clipPath>
        {/* The original burst loader hid its flying dots under a 10px border,
            swallowing them at the inner window — this clip reproduces it. */}
        <clipPath id={windowClipId}>
          <rect x='12.5' y='12.5' width='75' height='75' />
        </clipPath>
      </defs>
      <g filter={`url(#${filterId})`} fill={`url(#${gradientId})`}>
        {stages.map((v) => (
          <g
            key={v}
            clipPath={`url(#${v === 'burst' ? windowClipId : clipId})`}
            className={cn(styles.stage, v === shown && styles.stageActive)}
          >
            {VARIANT_SHAPES[v]}
          </g>
        ))}
      </g>
    </svg>
  )

  if (!displayLabel) return loader

  return (
    <span
      role='status'
      className={cn(styles.labelRow, className)}
      style={
        {
          '--tl-label-size': `${size * labelRatio}px`,
          '--tl-label-gap': `${size * 0.4}px`,
        } as CSSProperties
      }
    >
      {loader}
      <span className={styles.labelStack}>
        {exitingLabel ? (
          <span key={exitingLabel} className={cn(styles.labelLayer, styles.labelOut)}>
            <span className={styles.label}>{exitingLabel}</span>
          </span>
        ) : null}
        <span key={shownLabel} className={cn(styles.labelLayer, styles.labelIn)}>
          <span className={styles.label}>{shownLabel}</span>
        </span>
      </span>
    </span>
  )
}
