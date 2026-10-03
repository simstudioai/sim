import { cn } from '@sim/emcn'

interface SegmentedMeterProps {
  /** How much of the allowance is consumed, in the same unit as `total`. */
  used: number
  /** The allowance. Consumption beyond it renders in the overage tone. */
  total: number
  /**
   * How many segments to draw. Seats use one pill per seat so the meter is
   * countable; a credit allowance is in the tens of thousands, so it passes a fixed
   * count and reads as a percentage instead.
   */
  segments: number
  className?: string
}

/**
 * The settings allowance meter.
 *
 * Extracted so the seat meter and the usage meter cannot drift — they are the same
 * affordance answering the same question, and previously only one existed.
 */
export function SegmentedMeter({ used, total, segments, className }: SegmentedMeterProps) {
  /**
   * Both counts are measured against the larger of the two, so an overage has
   * somewhere to render. Scaling the fill by `total` and clamping it meant
   * `filledSegments` and the allowance were both `segments` whenever usage exceeded
   * the limit, and the overage tone below could never be reached — the meter simply
   * showed full.
   */
  const scale = Math.max(total, used)
  const filledSegments = scale > 0 ? Math.min(segments, Math.round((used / scale) * segments)) : 0
  const allowedSegments = scale > 0 ? Math.round((total / scale) * segments) : 0

  return (
    <div className={cn('flex items-center gap-1', className)} aria-hidden='true'>
      {Array.from({ length: segments }).map((_, index) => {
        const isFilled = index < filledSegments
        const isOverage = index >= allowedSegments && isFilled
        return (
          <div
            key={index}
            className={cn(
              'h-[6px] flex-1 rounded-full transition-colors',
              isOverage
                ? 'bg-[var(--badge-amber-text)]'
                : isFilled
                  ? 'bg-[var(--indicator-seat-filled)]'
                  : 'bg-[var(--border)]'
            )}
          />
        )
      })}
    </div>
  )
}
