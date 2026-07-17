'use client'

import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/components/ui/eval-status-indicator.module.css'

export type EvalStatusIndicatorStatus = 'progress' | 'partial' | 'complete' | 'failed'

/**
 * Squeeze cycle length (0.6s alternate = 1.2s full period) — the wall-clock
 * modulus for the shared negative animation-delay that phase-locks the
 * progress rings of instances mounted at different times (e.g. table rows).
 */
const SYNC_PERIOD_MS = 1_200

/** Accessible name announced for each status. */
const STATUS_LABEL: Record<EvalStatusIndicatorStatus, string> = {
  progress: 'In progress',
  partial: 'Partially complete',
  complete: 'Complete',
  failed: 'Failed',
}

export interface EvalStatusIndicatorProps {
  /** Which signal to show. Transitions between statuses melt through the goo filter. */
  status: EvalStatusIndicatorStatus
  /**
   * Completed fraction of the ring border shown by `partial`, as 0–100.
   * Ignored by the other statuses. Defaults to 50.
   */
  percent?: number
  /** Rendered square size in px. Defaults to 20. */
  size?: number
  /** Layout-only classes (margins, alignment). The indicator owns its chrome. */
  className?: string
  /**
   * Escape hatch for the ink material: merged onto the SVG, so a caller can
   * override the gradient/glow CSS vars (`--esi-grad-inner`, `--esi-grad-outer`,
   * `--esi-glow`) to match a surrounding surface. Use sparingly — the
   * indicator owns its look by default.
   */
  style?: CSSProperties
}

/**
 * Gooey eval run status indicator, built on the ThinkingLoader's metaball
 * material: ink shapes are blurred with feGaussianBlur, the soft alpha is
 * crushed back to a hard edge, and an inner white glow rides the silhouette.
 *
 * Statuses:
 * - `progress` — the outlined ring with two side bars squeezing in (the
 *   ThinkingLoader `squeeze` shape), running continuously while a case runs.
 * - `partial` — the same ring drawn only `percent` of the way around, over a
 *   faint full track. Static; for semi-complete results.
 * - `complete` — a solid ink disc. Entering it from another status melts the
 *   ring into the disc and plays a dip-and-pop scale bounce.
 * - `failed` — the same solid disc tinted signal orange, with the same bounce.
 *
 * All statuses render inside one filtered group and crossfade, so a status
 * change reads as one shape melting into the next rather than a hard swap.
 * The goo operates on the SVG's own alpha, so the indicator needs no backdrop
 * and composites on any background.
 *
 * @example
 * ```tsx
 * <EvalStatusIndicator status='progress' />
 * <EvalStatusIndicator status='partial' percent={80} />
 * ```
 */
export function EvalStatusIndicator({
  status,
  percent = 50,
  size = 20,
  className,
  style,
}: EvalStatusIndicatorProps) {
  // useId emits colons, which break url(#...) filter references — strip them.
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const filterId = `esi-goo-${id}`
  const clipId = `esi-clip-${id}`
  const gradientId = `esi-grad-${id}`

  // Dip-and-pop bounce, only when transitioning INTO a settled disc (complete
  // or failed) after mount — a row that first renders already-complete stays
  // still. The one-frame class drop lets a rapid complete→failed flip restart
  // the animation cleanly.
  const prevStatusRef = useRef(status)
  const [popping, setPopping] = useState(false)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === status) return
    if (status === 'complete' || status === 'failed') {
      setPopping(false)
      const raf = requestAnimationFrame(() => setPopping(true))
      return () => cancelAnimationFrame(raf)
    }
    setPopping(false)
  }, [status])

  // Phase-lock the squeeze animation to the wall clock (set after mount so
  // server and client markup agree) — progress rings in adjacent rows pulse
  // in unison regardless of when each mounted.
  const [syncDelay, setSyncDelay] = useState<string | undefined>(undefined)
  useEffect(() => {
    setSyncDelay(`-${Date.now() % SYNC_PERIOD_MS}ms`)
  }, [])

  const settled = status === 'complete' || status === 'failed'
  const arcPercent = Math.min(100, Math.max(0, percent))

  return (
    <svg
      role='img'
      aria-label={STATUS_LABEL[status]}
      viewBox='0 0 100 100'
      width={size}
      height={size}
      className={cn(styles.frame, status === 'failed' && styles.failed, className)}
      style={{
        ...(syncDelay ? ({ '--esi-sync': syncDelay } as CSSProperties) : {}),
        ...style,
      }}
    >
      <defs>
        {/* Same goo chain as the ThinkingLoader: blur → alpha crush → inner
            glow riding the merged silhouette. sRGB keeps the gradient's
            authored midtones through the blur. */}
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
          <feFlood className={styles.glow} result='glowColor' />
          <feComposite in='glowColor' in2='innerMask' operator='in' result='glow' />
          <feMerge>
            <feMergeNode in='goo' />
            <feMergeNode in='glow' />
          </feMerge>
        </filter>
        {/* Per-shape radial gradient (center → edge); stops read theme vars
            via CSS, and the `failed` frame class re-points them to orange. */}
        <radialGradient id={gradientId} cx='0.5' cy='0.5' r='0.5'>
          <stop className={styles.gradInner} />
          <stop offset='1' className={styles.gradOuter} />
        </radialGradient>
        {/* Shapes clip BEFORE the goo filter, so geometry leaving the frame
            melts into the edge instead of getting a hard post-filter cut. */}
        <clipPath id={clipId}>
          <rect width='100' height='100' />
        </clipPath>
      </defs>
      {/* Faint full track behind the partial arc. Kept OUTSIDE the filtered
          group: the goo's alpha crush (a*19-9) maps low opacities to zero, so
          a faint shape inside the goo would simply vanish. */}
      <circle
        className={cn(styles.track, status === 'partial' && styles.trackActive)}
        cx='50'
        cy='50'
        r='31.25'
        fill='none'
        strokeWidth='12.5'
      />
      <g
        className={cn(styles.popTarget, popping && styles.pop)}
        onAnimationEnd={() => setPopping(false)}
      >
        <g
          filter={`url(#${filterId})`}
          fill={`url(#${gradientId})`}
          stroke={`url(#${gradientId})`}
          strokeWidth={0}
        >
          {/* progress — the ThinkingLoader squeeze shape: two stroked ring
              arcs plus two bars pinching in. Arcs re-assert their own
              stroke-width against the group's 0. */}
          <g
            clipPath={`url(#${clipId})`}
            className={cn(styles.stage, status === 'progress' && styles.stageActive)}
          >
            <path d='M 21.36 37.5 A 31.25 31.25 0 0 1 78.64 37.5' fill='none' strokeWidth='12.5' />
            <path d='M 21.36 62.5 A 31.25 31.25 0 0 0 78.64 62.5' fill='none' strokeWidth='12.5' />
            <rect className={styles.squeezeBarL} x='15' y='37.5' width='12.5' height='25' />
            <rect className={styles.squeezeBarR} x='72.5' y='37.5' width='12.5' height='25' />
          </g>
          {/* partial — the same ring stroked only `percent` of the way
              around, starting at 12 o'clock and sweeping clockwise. */}
          <g
            clipPath={`url(#${clipId})`}
            className={cn(styles.stage, status === 'partial' && styles.stageActive)}
          >
            <circle
              cx='50'
              cy='50'
              r='31.25'
              fill='none'
              strokeWidth='12.5'
              pathLength={100}
              strokeDasharray={`${arcPercent} ${100 - arcPercent}`}
              transform='rotate(-90 50 50)'
            />
          </g>
          {/* complete / failed — one solid disc serves both; the `failed`
              frame class tints the shared gradient orange, and the stop-color
              transition tweens the ink between the two. */}
          <g
            clipPath={`url(#${clipId})`}
            className={cn(styles.stage, settled && styles.stageActive)}
          >
            <circle cx='50' cy='50' r='38' />
          </g>
        </g>
      </g>
    </svg>
  )
}
