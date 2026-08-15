import { Badge, ChipLink, Info } from '@sim/emcn'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

type Subscription = {
  id: string
  plan: string
  status: string
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
}

interface TeamSeatsOverviewProps {
  billingHref?: string
  subscriptionData: Subscription | null
  isLoadingSubscription: boolean
  totalSeats: number
  /** Seats consumed by actual members. Pending invites are not counted here. */
  usedSeats: number
}

export function TeamSeatsOverview({
  billingHref,
  subscriptionData,
  isLoadingSubscription,
  totalSeats,
  usedSeats,
}: TeamSeatsOverviewProps) {
  if (isLoadingSubscription) {
    return null
  }

  if (!subscriptionData) {
    return (
      <SettingsSection label='Seats'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 flex-col'>
            <span className='text-[var(--text-body)] text-small'>No active Team subscription</span>
            <span className='text-[var(--text-muted)] text-caption'>
              Purchase a Team plan to invite teammates to this organization.
            </span>
          </div>
          {billingHref && (
            <ChipLink href={billingHref} variant='primary'>
              View plans
            </ChipLink>
          )}
        </div>
      </SettingsSection>
    )
  }

  const isEnterprise = checkEnterprisePlan(subscriptionData)
  const isSeatDataPending = !isEnterprise && totalSeats === 0
  const isOverLimit = totalSeats > 0 && usedSeats > totalSeats

  if (isSeatDataPending) {
    return null
  }

  /**
   * Team plans have no fixed seat cap — the seat count is reconciled to the
   * member count, so a used/total ratio is always 100% and carries no
   * information. Show a plain seat count instead, and reserve the used/total
   * line for Enterprise, where seats are a fixed allotment.
   */
  if (!isEnterprise) {
    return (
      <SettingsSection label='Seats'>
        <span className='text-[var(--text-body)] text-small tabular-nums'>
          {usedSeats} {usedSeats === 1 ? 'seat' : 'seats'}
        </span>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      label='Seats'
      headerAccessory={
        <Info side='top' className='text-[var(--text-muted)]'>
          {isOverLimit
            ? 'You have more teammates than seats. Contact support to adjust your enterprise seat count.'
            : 'Contact support for enterprise seat changes.'}
        </Info>
      }
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='text-[var(--text-body)] text-small tabular-nums'>
          {usedSeats} used / {totalSeats} total
        </span>
        {isOverLimit && (
          <Badge variant='amber' size='sm'>
            Over limit
          </Badge>
        )}
      </div>
    </SettingsSection>
  )
}
