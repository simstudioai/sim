import { ChipTag, cn } from '@sim/emcn'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/tables/components/feature-graphics/enrichment-fill-graphic.module.css'

interface EnrichmentRowDef {
  /** The enrichment's column label, matching Sim's built-in enrichments. */
  label: string
  /** The found value the pass writes into the cell. */
  value: string
  /** Value treatment: `mono` for machine-shaped values, `strong` for names. */
  variant: 'mono' | 'strong'
}

/**
 * One lead's empty cells being completed, drawn from Sim's real enrichment
 * catalog (work email, phone number, company domain, company info) so the
 * ledger reads as the product's own enrichment pass.
 */
const ENRICHMENT_ROWS: readonly EnrichmentRowDef[] = [
  { label: 'Company domain', value: 'brightside.io', variant: 'mono' },
  { label: 'Work email', value: 'jonas@brightside.io', variant: 'mono' },
  { label: 'Phone number', value: '+1 (303) 555-0148', variant: 'mono' },
  { label: 'Company info', value: 'SaaS · 120 employees', variant: 'strong' },
] as const

/** Per-value fill classes - the stagger order is baked into each class's delay. */
const VALUE_STEP_CLASSES = [styles.value0, styles.value1, styles.value2, styles.value3] as const

/**
 * Enrichments told as a frameless key-value ledger (the run-monitoring
 * tile's composition, which shares the page): a small "Enrichments" header
 * with a quiet `Auto-run` mono ChipTag (fill stepped up to `--surface-6`
 * so the pill stays legible on the grey ground) names the surface, and a
 * "leads · Jonas Weber" attribution line pins the pass to one record.
 * Below, each of the four rows pairs an enrichment column label with the
 * value the pass found - the labels are Sim's real enrichment catalog
 * (company domain, work email, phone number, company info) - as airy rows
 * ruled by quiet 1px `--border-1` hairlines, values in mono or the
 * stronger sans ink.
 *
 * The found values fade up into their cells one after another (from
 * `enrichment-fill-graphic.module.css`, the audit tile's one-shot settle)
 * so the ledger reads as the pass completing the row - never re-played.
 * Under `prefers-reduced-motion` the values render fully settled.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled slot's
 * center.
 */
export function EnrichmentFillGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px] sm:max-lg:[@container(min-width:500px)]:max-w-[400px]'>
          <div className='mb-1 flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
              Enrichments
            </span>
            <ChipTag variant='mono' className='bg-[var(--surface-6)]'>
              Auto-run
            </ChipTag>
          </div>
          <span className='block text-[var(--text-muted)] text-caption'>leads · Jonas Weber</span>

          <div className='mt-2'>
            {ENRICHMENT_ROWS.map((row, index) => (
              <div
                key={row.label}
                className={cn(
                  'flex h-10 items-center justify-between gap-3',
                  index > 0 && 'border-[var(--border-1)] border-t'
                )}
              >
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>{row.label}</span>
                <span
                  className={cn(
                    'truncate',
                    row.variant === 'mono'
                      ? 'font-mono text-[var(--text-secondary)] text-caption'
                      : 'font-medium text-[var(--text-primary)] text-caption',
                    VALUE_STEP_CLASSES[index]
                  )}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
