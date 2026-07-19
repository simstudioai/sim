import { ChipTag, cn } from '@sim/emcn'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/run-monitoring-graphic.module.css'

export interface LogField {
  /** Row label, matching the workspace Log Details panel's key column. */
  label: string
  /** Right-aligned value cell text. */
  value: string
  /**
   * Value treatment: `strong` for the primary-name row, `chip` for the
   * quiet grey mono chip, `mono` for a bare mono value.
   */
  variant: 'strong' | 'chip' | 'mono'
}

/** One key/value pair of the closing JSON output card. */
export interface OutputPair {
  /** JSON key, rendered inside the muted scaffolding. */
  key: string
  /** Raw value literal, rendered in the stronger ink (include quotes for strings). */
  value: string
}

/**
 * The Log Details keys the real panel leads with, distilled to tile scale:
 * workflow name, shortened run id, trigger, and duration. The workspace
 * UI's green Level/Trigger tags become quiet grey mono chips per the
 * row's monochrome vocabulary.
 */
const LOG_FIELDS: readonly LogField[] = [
  { label: 'Workflow', value: 'Support agent', variant: 'strong' },
  { label: 'Run ID', value: 'afda69e9', variant: 'chip' },
  { label: 'Trigger', value: 'Schedule', variant: 'chip' },
  { label: 'Duration', value: '1.56s', variant: 'mono' },
] as const

/** The default two-line JSON payload of the enterprise run. */
const OUTPUT_PAIRS: readonly [OutputPair, OutputPair] = [
  { key: 'status', value: '"completed"' },
  { key: 'resolved', value: '24' },
] as const

/** Renders one field's right-aligned value cell in its declared treatment. */
function fieldValue(field: LogField) {
  if (field.variant === 'chip') {
    return (
      <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
        {field.value}
      </ChipTag>
    )
  }
  if (field.variant === 'mono') {
    return (
      <span className='font-mono text-[var(--text-secondary)] text-caption'>{field.value}</span>
    )
  }
  return (
    <span className='truncate font-medium text-[var(--text-primary)] text-caption'>
      {field.value}
    </span>
  )
}

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
 * workflow value and JSON lines truncate instead of clipping. On the
 * wide spanned tile of the two-column band (container ≥500px inside
 * `sm`..`lg`) the column relaxes to 400px so the key-value ledger's
 * rows take the wide slot's airier measure.
 *
 * Every label is parametrizable so other landing pages (IT, HR,
 * finance, workflows) can retell the live-run panel for their own
 * domain's monitors; the defaults keep the enterprise page's
 * Support-agent run byte-identical. Chrome, motion, and layout never
 * change with the copy.
 */
interface RunMonitoringGraphicProps {
  /** Panel title. */
  title?: string
  /** Live-status label beside the pulsing dot. */
  statusLabel?: string
  /** The key-value ledger rows. */
  fields?: readonly LogField[]
  /** Label above the JSON output card. */
  outputLabel?: string
  /** The two key/value pairs of the JSON output card. */
  outputPairs?: readonly [OutputPair, OutputPair]
}

export function RunMonitoringGraphic({
  title = 'Log details',
  statusLabel = 'Live',
  fields = LOG_FIELDS,
  outputLabel = 'Workflow output',
  outputPairs = OUTPUT_PAIRS,
}: RunMonitoringGraphicProps = {}) {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='mb-1.5 flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
              {title}
            </span>
            <span className='flex shrink-0 items-center gap-1.5'>
              <span
                className={cn('size-2 rounded-full bg-[var(--text-primary)]', styles.livePulse)}
              />
              <span className='text-[var(--text-muted)] text-caption'>{statusLabel}</span>
            </span>
          </div>

          {fields.map((field, index) => (
            <div
              key={field.label}
              className={cn(
                'flex h-9 items-center justify-between gap-3',
                index > 0 && 'border-[var(--border-1)] border-t'
              )}
            >
              <span className='shrink-0 text-[var(--text-muted)] text-caption'>{field.label}</span>
              {fieldValue(field)}
            </div>
          ))}

          <div className='mt-2'>
            <span className='block text-[var(--text-muted)] text-caption'>{outputLabel}</span>
            <div className='mt-1.5 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2 font-mono text-caption leading-[1.6] shadow-sm'>
              <div className='truncate whitespace-pre'>
                <span className='text-[var(--text-muted)]'>{`{ "${outputPairs[0].key}": `}</span>
                <span className='text-[var(--text-secondary)]'>{outputPairs[0].value}</span>
                <span className='text-[var(--text-muted)]'>,</span>
              </div>
              <div className='truncate whitespace-pre'>
                <span className='text-[var(--text-muted)]'>{`  "${outputPairs[1].key}": `}</span>
                <span className='text-[var(--text-secondary)]'>{outputPairs[1].value}</span>
                <span className='text-[var(--text-muted)]'>{' }'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
