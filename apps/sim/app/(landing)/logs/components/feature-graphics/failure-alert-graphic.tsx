import { cn } from '@sim/emcn'
import { SlackIcon } from '@/components/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/logs/components/feature-graphics/failure-alert-graphic.module.css'

/** Shared hairline ink for the run row, connector, and notification window. */
const OUTLINE_INK = 'border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'

/**
 * A failure caught by alerting, told top to bottom as the deploy tile's
 * causal vignette in the dark tiles' outlined ink: the failed run at the
 * top - an outlined pill pairing the workflow name with an outlined
 * "Error" tag and the failure time - a faint vertical hairline linking
 * cause to effect, and a minimal outlined Slack window rising from the
 * bottom edge with the alert Sim sent: the #oncall channel in the header
 * (the Slack mark is a real brand logo, the one place hex is allowed),
 * and the failure message with the failing block named, linking back to
 * the run's trace.
 *
 * Motion (from `failure-alert-graphic.module.css`): the run row stamps
 * in first, a white pulse falls down the connector, and the alert window
 * stamps in as the pulse lands - a one-shot settle, never re-played.
 * Under `prefers-reduced-motion` everything renders settled with no
 * pulse.
 */
export function FailureAlertGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex flex-col items-center pr-8 max-lg:pr-6'
      >
        <div
          className={cn(
            'mt-1 flex items-center gap-2 rounded-[10px] border py-1.5 pr-1.5 pl-2.5',
            OUTLINE_INK,
            styles.runRow
          )}
        >
          <span className='font-medium text-[var(--text-inverse)] text-caption'>
            Nightly data sync
          </span>
          <span
            className={cn(
              'flex h-5 items-center rounded-md border px-1.5 font-medium text-[var(--text-muted-inverse)] text-caption',
              OUTLINE_INK
            )}
          >
            Error
          </span>
          <span className='text-[var(--text-muted-inverse)] text-caption'>2:14 AM</span>
        </div>

        <span
          className={cn(
            'relative mt-2 mb-2 min-h-4 w-px flex-1 overflow-hidden',
            'bg-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'
          )}
        >
          <span className={styles.sweep} />
        </span>

        <div
          className={cn(
            'relative w-full rounded-t-xl border border-b-0',
            OUTLINE_INK,
            styles.alertWindow
          )}
        >
          <div className={cn('flex h-11 items-center gap-2 border-b px-3', OUTLINE_INK)}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-md border',
                OUTLINE_INK
              )}
            >
              <SlackIcon className='size-[12px]' />
            </span>
            <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-inverse)] text-small'>
              #oncall
            </span>
            <span className='shrink-0 text-[var(--text-muted-inverse)] text-caption'>Now</span>
          </div>
          <div className='px-3 pt-2.5 pb-4'>
            <span className='block font-medium text-[var(--text-inverse)] text-small'>
              Run failed: Nightly data sync
            </span>
            <span className='mt-1 block text-[var(--text-muted-inverse)] text-caption'>
              Timeout in Post to ledger · Open the trace in Sim
            </span>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
