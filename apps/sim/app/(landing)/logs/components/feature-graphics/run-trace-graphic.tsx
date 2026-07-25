import { cn, Library } from '@sim/emcn'
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

/** Span-name inks on the dark tile - parents brighter than nested children. */
const NAME_TONE_CLASS = {
  parent: 'text-[var(--text-inverse)]',
  child: 'text-[var(--text-muted-inverse)]',
} as const

/** Waterfall bar inks - the same two-step ramp as the names. */
const BAR_TONE_CLASS = {
  parent: 'bg-[var(--text-inverse)] opacity-80',
  child: 'bg-[var(--text-inverse)] opacity-40',
} as const

/** Shared hairline ink for the window outline, header rule, and icon box. */
const OUTLINE_INK = 'border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'

/**
 * A run's block-by-block trace told inside the agent-code tile's dark
 * outlined window: the window keeps that tile's exact slot geometry
 * (`top-5`, `left-0`, bleeding off the right and bottom edges,
 * `rounded-tl-xl`) as an outlined shell - faint `--text-muted-inverse`
 * hairlines with the dark tile showing through. Its `h-12` title bar
 * pairs the Library icon (in an outlined `size-6` icon box, the
 * agent-code header's treatment) with the run's workflow name and the
 * run's total duration in mono on the right.
 *
 * Inside, the workspace trace view's vocabulary at tile scale: each span
 * is a row with its block name (children indented and quieter, the real
 * tree's depth ramp), a waterfall bar offset by when the span started
 * and sized by how long it ran, and a right-aligned mono duration. The
 * rows stamp in top to bottom once (from `run-trace-graphic.module.css`,
 * the agent-code tile's one-shot settle); under `prefers-reduced-motion`
 * the trace renders fully settled.
 */
export function RunTraceGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className={cn(
          'absolute top-5 right-0 bottom-0 left-0 rounded-tl-xl border-t border-l',
          OUTLINE_INK
        )}
      >
        <div className={cn('flex h-12 items-center gap-2 border-b px-4', OUTLINE_INK)}>
          <span
            className={cn('flex size-6 items-center justify-center rounded-md border', OUTLINE_INK)}
          >
            <Library className='size-[14px] text-[var(--text-muted-inverse)]' />
          </span>
          <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-inverse)] text-base'>
            Support ticket routing
          </span>
          <span className='shrink-0 font-mono text-[var(--text-muted-inverse)] text-caption'>
            1.86s
          </span>
        </div>

        <div className='flex flex-col p-4'>
          {TRACE_SPANS.map((span, index) => (
            <div
              key={span.name}
              className={cn('flex h-9 items-center gap-3', ROW_STEP_CLASSES[index])}
            >
              <span
                className={cn(
                  'w-[38%] shrink-0 truncate font-medium text-caption',
                  NAME_TONE_CLASS[span.barTone],
                  span.indentClass
                )}
              >
                {span.name}
              </span>
              <span className='relative h-full min-w-0 flex-1'>
                <span
                  className={cn(
                    '-translate-y-1/2 absolute top-1/2 h-[6px] rounded-full',
                    BAR_TONE_CLASS[span.barTone],
                    span.barClass
                  )}
                />
              </span>
              <span className='w-11 shrink-0 text-right font-mono text-[var(--text-muted-inverse)] text-caption'>
                {span.duration}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
