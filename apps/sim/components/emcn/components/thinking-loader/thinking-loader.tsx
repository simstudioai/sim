'use client'

import { type CSSProperties, type ReactNode, useEffect, useId, useState } from 'react'
import styles from '@/components/emcn/components/thinking-loader/thinking-loader.module.css'
import { cn } from '@/lib/core/utils/cn'

const VARIANTS = [
  'metaballs',
  'orbit',
  'relay',
  'corners',
  'burst',
  'compass',
  'squeeze',
  'maze',
] as const

export type ThinkingLoaderVariant = (typeof VARIANTS)[number]

/**
 * One full animation loop per variant (duration × 2 for alternate
 * animations). While cycling, each pattern holds for exactly one loop
 * before morphing to the next.
 */
const VARIANT_LOOP_MS: Record<ThinkingLoaderVariant, number> = {
  metaballs: 2000,
  orbit: 2000,
  relay: 1000,
  corners: 800,
  burst: 800,
  compass: 2000,
  squeeze: 1200,
  maze: 2000,
}

/**
 * Fixed shuffle of the cycle so every instance walks the same pattern order.
 * Which pattern shows is a pure function of the wall clock, so loaders in
 * the chat switcher and the message stream stay in lockstep.
 */
const CYCLE_SEQUENCE: readonly ThinkingLoaderVariant[] = [
  'metaballs',
  'relay',
  'compass',
  'corners',
  'maze',
  'burst',
  'orbit',
  'squeeze',
]
const CYCLE_TOTAL_MS = CYCLE_SEQUENCE.reduce((sum, v) => sum + VARIANT_LOOP_MS[v], 0)

/**
 * Common multiple of every shape animation period (800/1000/1200/2000ms,
 * alternates doubled) — the wall-clock modulus for the shared negative
 * animation-delay that phase-locks instances mounted at different times.
 */
const SYNC_PERIOD_MS = 12_000

/** The pattern the shared timeline is on right now, and how long it holds. */
function variantAtNow(): { variant: ThinkingLoaderVariant; msUntilNext: number } {
  let t = Date.now() % CYCLE_TOTAL_MS
  for (const v of CYCLE_SEQUENCE) {
    const hold = VARIANT_LOOP_MS[v]
    if (t < hold) return { variant: v, msUntilNext: hold - t }
    t -= hold
  }
  return { variant: CYCLE_SEQUENCE[0], msUntilNext: VARIANT_LOOP_MS[CYCLE_SEQUENCE[0]] }
}

/**
 * Ink shapes per variant, authored in the shared 100x100 viewBox.
 * Geometry mirrors the intrinsic CSS loaders these were adapted from,
 * contain-fit to the canvas. Animations live in the CSS module.
 */
const VARIANT_SHAPES: Record<ThinkingLoaderVariant, ReactNode> = {
  metaballs: (
    <>
      <circle className={styles.metaballsA} cx='20' cy='50' r='20' />
      <circle className={styles.metaballsB} cx='80' cy='50' r='20' />
    </>
  ),
  orbit: (
    <>
      <rect className={styles.orbitA} x='10' y='10' width='40' height='40' />
      <rect className={styles.orbitB} x='10' y='10' width='40' height='40' />
    </>
  ),
  relay: (
    <>
      <rect x='10' y='30' width='20' height='40' />
      <rect x='70' y='30' width='20' height='40' />
      <circle className={styles.relayBall} cx='20' cy='50' r='10' />
    </>
  ),
  corners: (
    <>
      <rect x='25' y='25' width='50' height='50' />
      <circle className={styles.cornersA} cx='25' cy='25' r='12.5' />
      <circle className={styles.cornersB} cx='75' cy='25' r='12.5' />
      <circle className={styles.cornersC} cx='75' cy='75' r='12.5' />
      <circle className={styles.cornersD} cx='25' cy='75' r='12.5' />
    </>
  ),
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
      <circle cx='50' cy='25' r='12.5' />
      <circle cx='25' cy='50' r='12.5' />
      <circle cx='75' cy='50' r='12.5' />
      <circle cx='50' cy='75' r='12.5' />
      <circle className={styles.compassMover} cx='50' cy='25' r='12.5' />
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
  maze: (
    <>
      <path d='M 12.5 12.5 H 87.5 V 27.5 H 27.5 V 87.5 H 12.5 Z' />
      <path d='M 87.5 12.5 V 87.5 H 12.5 V 72.5 H 72.5 V 12.5 Z' />
      <circle className={styles.mazeDot} cx='27.5' cy='27.5' r='15' />
    </>
  ),
}

export interface ThinkingLoaderProps {
  /** Pin one pattern. When omitted, the loader morphs between all patterns at random. */
  variant?: ThinkingLoaderVariant
  /** Rendered square size in px. Defaults to 20. */
  size?: number
  /** Optional status text (e.g. "Thinking…") rendered beside the goo with a shimmer sweep. */
  label?: string
  /** Layout-only classes (margins, alignment). The loader owns its chrome. */
  className?: string
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
export function ThinkingLoader({ variant, size = 20, label, className }: ThinkingLoaderProps) {
  // useId emits colons, which break url(#...) filter references — strip them.
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const filterId = `tl-goo-${id}`
  const clipId = `tl-clip-${id}`
  const windowClipId = `tl-window-${id}`
  const [cycleVariant, setCycleVariant] = useState<ThinkingLoaderVariant>('metaballs')
  const cycling = variant === undefined

  useEffect(() => {
    if (!cycling) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let timeout: ReturnType<typeof setTimeout>
    const tick = () => {
      const { variant: next, msUntilNext } = variantAtNow()
      setCycleVariant(next)
      timeout = setTimeout(tick, msUntilNext)
    }
    tick()
    return () => clearTimeout(timeout)
  }, [cycling])

  // Phase-lock the CSS animations to the wall clock (set after mount so
  // server and client markup agree). All instances share the same negative
  // delay modulus, so their keyframes line up regardless of mount time.
  const [syncDelay, setSyncDelay] = useState<string | undefined>(undefined)
  useEffect(() => {
    setSyncDelay(`-${Date.now() % SYNC_PERIOD_MS}ms`)
  }, [])

  const shown = variant ?? cycleVariant
  const stages = cycling ? VARIANTS : [shown]

  const loader = (
    <svg
      role={label ? undefined : 'status'}
      aria-label={label ? undefined : 'Thinking'}
      aria-hidden={label ? true : undefined}
      viewBox='0 0 100 100'
      width={size}
      height={size}
      className={cn(styles.frame, !label && className)}
      style={syncDelay ? ({ '--tl-sync': syncDelay } as CSSProperties) : undefined}
    >
      <defs>
        <filter id={filterId} x='-30%' y='-30%' width='160%' height='160%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation='5' result='blur' />
          <feColorMatrix in='blur' values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9' />
        </filter>
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
      <g filter={`url(#${filterId})`} fill='currentColor'>
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

  if (!label) return loader

  return (
    <span role='status' className={cn(styles.labelRow, className)}>
      {loader}
      <span className={styles.label}>{label}</span>
    </span>
  )
}
