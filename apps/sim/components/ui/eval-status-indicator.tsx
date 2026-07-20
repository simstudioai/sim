'use client'

import { useId } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/components/ui/eval-status-indicator.module.css'

export type EvalStatusIndicatorStatus =
  | 'pending'
  | 'progress'
  | 'complete'
  | 'failed'
  | 'partial-success'
  | 'partial-failure'

interface EvalStatusIndicatorBaseProps {
  /** Rendered square size in pixels. */
  size?: number
  /** Layout-only classes. The indicator owns its chrome. */
  className?: string
  /** Draws a concentric selection ring outside the status ink. */
  selected?: boolean
  /** Chooses the same gradient family as the selected result. */
  selectionTone?: 'ink' | 'failure'
}

type EvalStatusIndicatorVisualProps =
  | {
      /** Animated or fully compressed squeeze geometry. */
      status: 'progress'
      progressMode?: 'animated' | 'squeezed'
    }
  | {
      /** Visual state of a settled or pending test. */
      status: Exclude<EvalStatusIndicatorStatus, 'progress'>
      progressMode?: never
    }

export type EvalStatusIndicatorProps = EvalStatusIndicatorBaseProps &
  EvalStatusIndicatorVisualProps &
  (
    | {
        /** Accessible label containing the test name and its current state. */
        label: string
        decorative?: false
      }
    | {
        /** Removes the indicator from the accessibility tree for visual-only filler slots. */
        decorative: true
        label?: never
      }
  )

interface StatusShapeProps {
  status: EvalStatusIndicatorStatus
  progressMode: 'animated' | 'squeezed'
  filterId: string
  inkGradientId: string
  failureGradientId: string
}

const PARTIAL_RADIUS = 31.25
const PARTIAL_STROKE_WIDTH = 12.5
const PARTIAL_PERCENT = 80

function StatusShape({
  status,
  progressMode,
  filterId,
  inkGradientId,
  failureGradientId,
}: StatusShapeProps) {
  if (status === 'pending') {
    return <circle className={styles.pendingRing} cx='50' cy='50' r='32' />
  }

  if (status === 'progress') {
    return (
      <g
        className={styles.progressInk}
        filter={`url(#${filterId})`}
        fill={`url(#${inkGradientId})`}
        stroke={`url(#${inkGradientId})`}
        data-eval-progress-mode={progressMode}
      >
        <path d='M 21.36 37.5 A 31.25 31.25 0 0 1 78.64 37.5' fill='none' strokeWidth='12.5' />
        <path d='M 21.36 62.5 A 31.25 31.25 0 0 0 78.64 62.5' fill='none' strokeWidth='12.5' />
        <rect
          className={progressMode === 'animated' ? styles.squeezeBarLeft : undefined}
          x='15'
          y='37.5'
          width='12.5'
          height='25'
          transform={progressMode === 'squeezed' ? 'translate(10 0)' : undefined}
        />
        <rect
          className={progressMode === 'animated' ? styles.squeezeBarRight : undefined}
          x='72.5'
          y='37.5'
          width='12.5'
          height='25'
          transform={progressMode === 'squeezed' ? 'translate(-10 0)' : undefined}
        />
      </g>
    )
  }

  const failed = status === 'failed' || status === 'partial-failure'
  const gradientId = failed ? failureGradientId : inkGradientId
  const partial = status === 'partial-success' || status === 'partial-failure'

  if (partial) {
    return (
      <g>
        <circle
          className={styles.partialResultTrack}
          cx='50'
          cy='50'
          r={PARTIAL_RADIUS}
          fill='none'
          strokeWidth={PARTIAL_STROKE_WIDTH}
        />
        <circle
          cx='50'
          cy='50'
          r={PARTIAL_RADIUS}
          fill='none'
          stroke={`url(#${gradientId})`}
          strokeWidth={PARTIAL_STROKE_WIDTH}
          pathLength={100}
          strokeDasharray={`${PARTIAL_PERCENT} ${100 - PARTIAL_PERCENT}`}
          transform='rotate(-90 50 50)'
        />
      </g>
    )
  }

  return <circle cx='50' cy='50' r='34' fill={`url(#${gradientId})`} />
}

/**
 * Test-level eval result dot. Only `progress` mounts animated geometry;
 * pending and settled indicators are static.
 */
export function EvalStatusIndicator({
  status,
  progressMode = 'animated',
  label,
  decorative = false,
  size = 18,
  className,
  selected = false,
  selectionTone = 'ink',
}: EvalStatusIndicatorProps) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const filterId = `eval-status-goo-${id}`
  const inkGradientId = `eval-status-ink-${id}`
  const failureGradientId = `eval-status-failure-${id}`
  const usesInkGradient =
    status === 'progress' ||
    status === 'complete' ||
    status === 'partial-success' ||
    (selected && selectionTone === 'ink')
  const usesFailureGradient =
    status === 'failed' || status === 'partial-failure' || (selected && selectionTone === 'failure')
  const hasDefinitions = usesInkGradient || usesFailureGradient

  return (
    <svg
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      data-eval-status={status}
      viewBox='0 0 100 100'
      width={size}
      height={size}
      className={cn(styles.frame, className)}
    >
      {hasDefinitions ? (
        <defs>
          {status === 'progress' ? (
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
          ) : null}
          {usesInkGradient ? (
            <radialGradient id={inkGradientId} cx='0.5' cy='0.5' r='0.5'>
              <stop className={styles.inkGradientInner} />
              <stop offset='1' className={styles.inkGradientOuter} />
            </radialGradient>
          ) : null}
          {usesFailureGradient ? (
            <radialGradient id={failureGradientId} cx='0.5' cy='0.5' r='0.5'>
              <stop className={styles.failureGradientInner} />
              <stop offset='1' className={styles.failureGradientOuter} />
            </radialGradient>
          ) : null}
        </defs>
      ) : null}
      {selected ? (
        <circle
          className={styles.selectionRing}
          cx='50'
          cy='50'
          r='44'
          fill='none'
          stroke={`url(#${selectionTone === 'failure' ? failureGradientId : inkGradientId})`}
          data-eval-selection-ring
        />
      ) : null}
      <StatusShape
        status={status}
        progressMode={progressMode}
        filterId={filterId}
        inkGradientId={inkGradientId}
        failureGradientId={failureGradientId}
      />
    </svg>
  )
}
