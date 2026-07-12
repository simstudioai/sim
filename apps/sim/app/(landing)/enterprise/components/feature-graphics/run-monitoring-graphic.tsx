import type { ReactNode } from 'react'
import { ChipTag, cn } from '@sim/emcn'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/run-monitoring-graphic.module.css'

interface LogField {
  /** Row label, matching the workspace Log Details panel's key column. */
  label: string
  /** Right-aligned value cell — plain text or a quiet mono chip. */
  value: ReactNode
}

/**
 * The Log Details keys the real panel leads with, distilled to tile scale:
 * workflow name, shortened run id, trigger, and duration. The workspace
 * UI's green Level/Trigger tags become quiet grey mono chips per the
 * row's monochrome vocabulary.
 */
const LOG_FIELDS: readonly LogField[] = [
  {
    label: 'Workflow',
    value: (
      <span className='truncate font-medium text-[var(--text-primary)] text-caption'>
        Support agent
      </span>
    ),
  },
  {
    label: 'Run ID',
    value: (
      <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
        afda69e9
      </ChipTag>
    ),
  },
  {
    label: 'Trigger',
    value: (
      <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
        Schedule
      </ChipTag>
    ),
  },
  {
    label: 'Duration',
    value: <span className='font-mono text-[var(--text-secondary)] text-caption'>1.56s</span>,
  },
] as const

/**
 * The workspace's Log Details panel told as a frameless vignette (the
 * access and standards tiles' composition): no window chrome — a small
 * "Log details" header with a live-status dot (the tile's one emphasized
 * motion) sits directly on the tile ground above the panel's key-value
 * ledger — Workflow, shortened Run ID, Trigger, and Duration as airy
 * rows ruled by quiet 1px `--border-1` hairlines, the real UI's green
 * tags quieted to grey mono chips (fills stepped up to `--surface-6` so
 * the pills stay legible on the grey ground). The closing "Workflow
 * output" section
 * lifts its two-line JSON fragment onto the tile's highlight: a white
 * card in the audit tile's exact chrome (`--white` fill, 1px `--border-1`
 * hairline, rounded, `shadow-sm`), the run's payload presented as the
 * artifact worth watching.
 *
 * The only motion is the soft ring pulse on the live dot (from
 * `run-monitoring-graphic.module.css`), the family's shared quiet 6s
 * beat, removed under `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. The column is fluid (`w-full max-w-[312px]`) so it
 * never exceeds the compensated slot at narrow tile widths — the
 * workflow value and JSON lines truncate instead of clipping.
 */
export function RunMonitoringGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px]'>
          <div className='mb-1.5 flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
              Log details
            </span>
            <span className='flex shrink-0 items-center gap-1.5'>
              <span
                className={cn('size-2 rounded-full bg-[var(--text-primary)]', styles.livePulse)}
              />
              <span className='text-[var(--text-muted)] text-caption'>Live</span>
            </span>
          </div>

          {LOG_FIELDS.map((field, index) => (
            <div
              key={field.label}
              className={cn(
                'flex h-9 items-center justify-between gap-3',
                index > 0 && 'border-[var(--border-1)] border-t'
              )}
            >
              <span className='shrink-0 text-[var(--text-muted)] text-caption'>{field.label}</span>
              {field.value}
            </div>
          ))}

          <div className='mt-2'>
            <span className='block text-[var(--text-muted)] text-caption'>Workflow output</span>
            <div className='mt-1.5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2 font-mono text-caption leading-[1.6] shadow-sm'>
              <div className='truncate whitespace-pre'>
                <span className='text-[var(--text-muted)]'>{'{ "status": '}</span>
                <span className='text-[var(--text-secondary)]'>"completed"</span>
                <span className='text-[var(--text-muted)]'>,</span>
              </div>
              <div className='truncate whitespace-pre'>
                <span className='text-[var(--text-muted)]'>{'  "resolved": '}</span>
                <span className='text-[var(--text-secondary)]'>24</span>
                <span className='text-[var(--text-muted)]'>{' }'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
