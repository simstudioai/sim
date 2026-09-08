import { cn, Library } from '@sim/emcn'
import { LANDING_STAGE_WINDOW_RADIUS } from '@/app/(landing)/components/landing-layout'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/logs/components/feature-graphics/run-trace-graphic.module.css'

interface TraceSpanRow {
  /** Block name in the trace tree. */
  name: string
  /** Duration text, right-aligned in mono. */
  duration: string
  /** Indent class for child spans nested under the agent. */
  indentClass?: string
  /** Waterfall bar geometry - left offset and width as arbitrary classes. */
  barClass: string
  /** Bar ink - parents solid, children lighter, so depth reads at a glance. */
  barTone: 'parent' | 'child'
}

/**
 * The support-routing run's trace distilled to tile scale: the run's
 * top-level blocks with the agent's tool call and model reply nested
 * beneath it, each span's waterfall bar offset by when it started.
 */
const TRACE_SPANS: readonly TraceSpanRow[] = [
  {
    name: 'Start',
    duration: '12ms',
    barClass: 'left-0 w-[4%]',
    barTone: 'parent',
  },
  {
    name: 'Support agent',
    duration: '1.24s',
    barClass: 'left-[5%] w-[66%]',
    barTone: 'parent',
  },
  {
    name: 'Search tickets',
    duration: '420ms',
    indentClass: 'pl-3',
    barClass: 'left-[9%] w-[24%]',
    barTone: 'child',
  },
  {
    name: 'Generate reply',
    duration: '540ms',
    indentClass: 'pl-3',
    barClass: 'left-[38%] w-[30%]',
    barTone: 'child',
  },
  {
    name: 'Send to Slack',
    duration: '180ms',
    barClass: 'left-[74%] w-[11%]',
    barTone: 'parent',
  },
] as const

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2, styles.row3, styles.row4] as const

/**
 * The window's palette: the homepage rail's card, wearing the same chrome the
 * sibling product graphics use (`--white` fill, 1px `--border` hairline,
 * `shadow-xs`) so the trace reads as the workspace's own run view, with a
 * two-step parent/child ramp so nested spans stay quieter than the blocks
 * they hang under.
 */
const PALETTE = {
  name: {
    parent: 'text-[var(--text-primary)]',
    child: 'text-[var(--text-muted)]',
  },
  bar: {
    parent: 'bg-[var(--text-secondary)]',
    child: 'bg-[var(--text-muted)]',
  },
} as const

/**
 * A run's block-by-block trace told inside an outlined window inset on all
 * sides with the landing stage radius, so the trace does not clip the tall
 * card's corners. Its `h-12` title bar pairs the Library icon (in an outlined
 * `size-6` icon box) with the run's workflow name and the run's total
 * duration in mono on the right.
 *
 * Inside, the workspace trace view's vocabulary at tile scale: each span
 * is a row with its block name (children indented and quieter, the real
 * tree's depth ramp), a waterfall bar offset by when the span started
 * and sized by how long it ran, and a right-aligned mono duration. The
 * rows stamp in top to bottom once (from `run-trace-graphic.module.css`,
 * a one-shot settle); under `prefers-reduced-motion`
 * the trace renders fully settled.
 */
export function RunTraceGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div
        aria-hidden='true'
        className={cn(
          'absolute inset-[10px] flex flex-col overflow-hidden border border-[var(--border)] bg-[var(--white)] shadow-xs dark:bg-[var(--surface-4)]',
          LANDING_STAGE_WINDOW_RADIUS
        )}
      >
        <div className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
          <span className='flex size-6 items-center justify-center rounded-md border border-[var(--border)]'>
            <Library className='size-[14px] text-[var(--text-icon)]' />
          </span>
          <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-base'>
            Support ticket routing
          </span>
          <span className='shrink-0 font-mono text-[var(--text-muted)] text-caption'>1.86s</span>
        </div>

        <div className='flex min-h-0 flex-1 flex-col justify-evenly p-4 py-5'>
          {TRACE_SPANS.map((span, index) => (
            <div
              key={span.name}
              className={cn('flex h-9 items-center gap-3', ROW_STEP_CLASSES[index])}
            >
              <span
                className={cn(
                  'w-[38%] shrink-0 truncate text-caption',
                  PALETTE.name[span.barTone],
                  span.indentClass
                )}
              >
                {span.name}
              </span>
              <span className='relative h-full min-w-0 flex-1'>
                <span
                  className={cn(
                    '-translate-y-1/2 absolute top-1/2 h-[6px] rounded-full',
                    PALETTE.bar[span.barTone],
                    span.barClass
                  )}
                />
              </span>
              <span className='w-11 shrink-0 text-right font-mono text-[var(--text-muted)] text-caption'>
                {span.duration}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
