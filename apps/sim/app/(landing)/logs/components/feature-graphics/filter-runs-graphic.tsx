import { Badge, ChipTag, cn, Search } from '@sim/emcn'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/logs/components/feature-graphics/filter-runs-graphic.module.css'

interface FilteredRun {
  /** Workflow name of the matched run. */
  workflow: string
  /** Run timestamp, newest first. */
  time: string
}

/** The three failed runs the query and filters surface, newest first. */
const MATCHED_RUNS: readonly FilteredRun[] = [
  { workflow: 'Nightly data sync', time: 'Jul 12  2:14 AM' },
  { workflow: 'Nightly data sync', time: 'Jul 9  2:14 AM' },
  { workflow: 'Nightly data sync', time: 'Jul 6  2:15 AM' },
] as const

/** Active filter chips above the results, the options bar's vocabulary. */
const FILTER_CHIPS = ['Status: Error', 'Trigger: Schedule', 'Past 7 days'] as const

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2] as const

/**
 * Search and filters told as a frameless centered vignette (the audit and
 * monitoring tiles' composition): a small "Search runs" header with a
 * match-count mono ChipTag (fill stepped up to `--surface-6` so the pill
 * stays legible on the grey ground), the query itself lifted onto the
 * tile's highlight - a white card in the audit tile's exact chrome
 * (`--white` fill, 1px `--border-1` hairline, rounded, `shadow-sm`) with
 * a blinking caret holding the query - a row of quiet mono filter chips,
 * and the three matched runs as airy rows ruled by 1px `--border-1`
 * hairlines, each pairing the workflow name with its Error badge and
 * timestamp.
 *
 * Motion: the result rows stamp in top to bottom once (from
 * `filter-runs-graphic.module.css`, the audit tile's one-shot settle);
 * the caret blink is Tailwind's `animate-pulse`, disabled through its own
 * `motion-reduce:animate-none`. Under `prefers-reduced-motion` the rows
 * render fully settled.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. On the wide spanned tile of the two-column band
 * (container ≥500px inside `sm`..`lg`) the column relaxes to 400px.
 */
export function FilterRunsGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='mb-2.5 flex items-center justify-between'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Search runs</span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              3 matches
            </ChipTag>
          </div>

          <div className='flex items-center gap-2.5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2 shadow-sm'>
            <Search className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='min-w-0 truncate text-[var(--text-body)] text-caption'>
              nightly sync
              <span className='ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-[var(--text-primary)] align-text-bottom motion-reduce:animate-none' />
            </span>
          </div>

          <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
            {FILTER_CHIPS.map((chip) => (
              <ChipTag key={chip} variant='mono' className='bg-[var(--surface-6)]'>
                {chip}
              </ChipTag>
            ))}
          </div>

          <div className='mt-1.5'>
            {MATCHED_RUNS.map((run, index) => (
              <div
                key={run.time}
                className={cn(
                  'flex h-10 items-center justify-between gap-3',
                  index > 0 && 'border-[var(--border-1)] border-t',
                  ROW_STEP_CLASSES[index]
                )}
              >
                <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-caption'>
                  {run.workflow}
                </span>
                <span className='flex shrink-0 items-center gap-2.5'>
                  <Badge variant='gray' size='sm' dot>
                    Error
                  </Badge>
                  <span className='text-[var(--text-muted)] text-caption'>{run.time}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
