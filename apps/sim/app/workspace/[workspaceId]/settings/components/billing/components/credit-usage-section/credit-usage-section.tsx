'use client'

import { ChipLink } from '@sim/emcn'
import { formatCreditsLabel } from '@/lib/billing/credits/conversion'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUsageSummary } from '@/hooks/queries/usage-logs'

/** Period the compact Billing glance summarizes; the full page offers finer control. */
const SUMMARY_PERIOD = '30d'

/**
 * Compact "how much have I used" glance in Billing settings — a single total
 * plus a link to the full, filterable Credit usage page. Shown to every plan
 * except Enterprise, which manages billing out-of-band.
 */
export function CreditUsageSection() {
  const { data: totalCredits, isPending, isError } = useUsageSummary(SUMMARY_PERIOD)

  return (
    <SettingsSection label='Credit usage'>
      <div className='flex items-center justify-between px-2'>
        <div className='flex flex-col justify-center gap-[1px]'>
          <span className='text-[var(--text-body)] text-sm tabular-nums'>
            {isPending || isError ? '—' : formatCreditsLabel(totalCredits ?? 0)}
          </span>
          <span className='text-[var(--text-muted)] text-caption'>Last 30 days</span>
        </div>
        <ChipLink href='/account/settings/billing/credit-usage'>View usage logs</ChipLink>
      </div>
    </SettingsSection>
  )
}
