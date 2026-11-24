'use client'

import type { OrganizationBillingSummary } from '@/lib/api/contracts/organization'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface EnterpriseSeatsSectionProps {
  terms: NonNullable<OrganizationBillingSummary['enterpriseSelfServe']>
  billingInterval: 'month' | 'year'
}

function SeatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='text-[var(--text-body)] text-small'>{label}</span>
      <span className='text-[var(--text-muted)] text-small'>{value}</span>
    </div>
  )
}

/**
 * Self-serve Enterprise seat terms. Additional seats are the open true-up window's peak (a quarter,
 * or the month on a monthly contract), which the next true-up bills.
 */
export function EnterpriseSeatsSection({ terms, billingInterval }: EnterpriseSeatsSectionProps) {
  const trueUpWindow = billingInterval === 'year' ? 'quarter' : 'month'
  return (
    <SettingsSection label='Seats'>
      <div className='flex flex-col gap-4'>
        <SeatRow label='Contracted seats' value={String(terms.contractSeats)} />
        <SeatRow
          label='Additional seat price'
          value={`$${(terms.seatPriceCents / 100).toFixed(2)} per seat per month`}
        />
        <SeatRow
          label={`Additional seats this ${trueUpWindow}`}
          value={String(terms.peakExtraSeats)}
        />
      </div>
    </SettingsSection>
  )
}
