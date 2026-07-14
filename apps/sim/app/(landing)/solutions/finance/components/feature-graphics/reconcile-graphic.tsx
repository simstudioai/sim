import { ChipTag, cn } from '@sim/emcn'
import { CircleCheck } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/solutions/finance/components/feature-graphics/reconcile-graphic.module.css'

interface MatchedRow {
  /** Transaction label. */
  label: string
  /** Right-aligned amount. */
  amount: string
}

/** The auto-matched transactions, quiet passing rows above the exception. */
const MATCHED_ROWS: readonly MatchedRow[] = [
  { label: 'Stripe payout', amount: '$8,214.20' },
  { label: 'Payroll run', amount: '$42,900.00' },
  { label: 'AWS invoice', amount: '$3,118.75' },
] as const

/** Per-index stamp-in classes — the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2] as const

/**
 * Account reconciliation told as a frameless match ledger (the audit and
 * monitoring tiles' composition — no window chrome): a small
 * "Reconciliation" header with a mono period tag (fill stepped up to
 * `--surface-6` so the pill stays legible on the grey ground) sits
 * directly on the tile above the matched transactions — quiet
 * hairline-ruled rows, each a passing circle-check, the transaction
 * label, and a right-aligned mono amount. The tile's highlight is the
 * one exception: a white card in the audit tile's exact chrome
 * (`--white` fill, 1px `--border-1` hairline, `rounded-xl`, `shadow-sm`)
 * pairing the unmatched transaction and its routed-for-review line with
 * a `Flagged` tag that carries the tile's one repeating motion, the
 * family's shared quiet 6s ring pulse.
 *
 * Motion (from `reconcile-graphic.module.css`): the matched rows stamp
 * in top to bottom one after another — a one-shot settle, the audit
 * tile's append vocabulary, since matches are confirmed once — then the
 * exception card lands last and its tag pulses. Everything is removed
 * under `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. The column is fluid (`w-full max-w-[312px]`) so it
 * never exceeds the compensated slot at narrow tile widths — labels
 * truncate instead of clipping.
 */
export function ReconcileGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='w-full max-w-[312px]'>
          <div className='mb-1.5 flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-base'>
              Reconciliation
            </span>
            <ChipTag variant='mono' className='shrink-0 bg-[var(--surface-6)]'>
              March close
            </ChipTag>
          </div>

          {MATCHED_ROWS.map((row, index) => (
            <div
              key={row.label}
              className={cn(
                'flex h-9 items-center gap-2',
                index > 0 && 'border-[var(--border-1)] border-t',
                ROW_STEP_CLASSES[index]
              )}
            >
              <CircleCheck className='size-[13px] shrink-0 text-[var(--text-icon)]' />
              <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)] text-caption'>
                {row.label}
              </span>
              <span className='shrink-0 font-mono text-[var(--text-muted)] text-caption'>
                {row.amount}
              </span>
            </div>
          ))}

          <div
            className={cn(
              'mt-2 flex items-center gap-3 rounded-xl border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm',
              styles.exceptionIn
            )}
          >
            <span className='min-w-0 flex-1'>
              <span className='flex items-center gap-2'>
                <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-small'>
                  Wire transfer
                </span>
                <span className='shrink-0 font-mono text-[var(--text-secondary)] text-caption'>
                  $12,400.00
                </span>
              </span>
              <span className='mt-0.5 block truncate text-[var(--text-muted)] text-caption'>
                No ledger match · routed for review
              </span>
            </span>
            <ChipTag variant='gray' className={cn('shrink-0 shadow-none', styles.flaggedPulse)}>
              Flagged
            </ChipTag>
          </div>

          <div className='mt-1.5 flex h-9 items-center gap-2 px-3'>
            <CircleCheck className='size-[13px] shrink-0 text-[var(--text-icon)]' />
            <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)] text-caption'>
              Matched automatically
            </span>
            <span className='shrink-0 text-[var(--text-muted)] text-caption'>132 of 133</span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
