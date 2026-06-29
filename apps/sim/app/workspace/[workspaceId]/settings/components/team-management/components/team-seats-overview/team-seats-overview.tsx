import { Badge, Chip, cn } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
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
  subscriptionData: Subscription | null
  isLoadingSubscription: boolean
  totalSeats: number
  /** Seats consumed by actual members. Pending invites are not counted here. */
  usedSeats: number
  /** Outstanding invites that have not been accepted yet (do not consume a seat). */
  pendingSeats?: number
}

export function TeamSeatsOverview({
  subscriptionData,
  isLoadingSubscription,
  totalSeats,
  usedSeats,
  pendingSeats = 0,
}: TeamSeatsOverviewProps) {
  const router = useRouter()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  if (isLoadingSubscription) {
    return null
  }

  if (!subscriptionData) {
    return (
      <SettingsSection label='Seats'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 flex-col'>
            <span className='text-[var(--text-body)] text-small'>No active Team subscription</span>
            <span className='text-[var(--text-muted)] text-small'>
              Purchase a Team plan to invite teammates to this organization.
            </span>
          </div>
          <Chip
            variant='primary'
            flush
            onClick={() => {
              if (workspaceId) {
                router.push(`/workspace/${workspaceId}/settings/billing`)
              }
            }}
            disabled={!workspaceId}
          >
            View plans
          </Chip>
        </div>
      </SettingsSection>
    )
  }

  const isEnterprise = checkEnterprisePlan(subscriptionData)
  const isSeatDataPending = !isEnterprise && totalSeats === 0
  const isOverLimit = totalSeats > 0 && usedSeats > totalSeats
  const pillCount = Math.max(totalSeats, usedSeats, 1)

  if (isSeatDataPending) {
    return null
  }

  const pendingBadge =
    pendingSeats > 0 ? (
      <Badge variant='gray-secondary' size='sm'>
        {pendingSeats} pending
      </Badge>
    ) : null

  /**
   * Team plans have no fixed seat cap — the seat count is reconciled to the
   * member count, so a used/total ratio (and its meter) is always 100% and
   * carries no information. Show a plain seat count instead, and reserve the
   * cap meter for Enterprise, where seats are a fixed allotment.
   */
  if (!isEnterprise) {
    return (
      <SettingsSection label='Seats'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-[var(--text-body)] text-small tabular-nums'>
            {usedSeats} {usedSeats === 1 ? 'seat' : 'seats'}
          </span>
          {pendingBadge}
        </div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection label='Seats'>
      <div className='flex flex-col gap-2.5'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-[var(--text-body)] text-small tabular-nums'>
            {usedSeats} used / {totalSeats} total
          </span>
          <div className='flex items-center gap-1.5'>
            {pendingBadge}
            {isOverLimit && (
              <Badge variant='amber' size='sm'>
                Over limit
              </Badge>
            )}
          </div>
        </div>

        <div className='flex items-center gap-1'>
          {Array.from({ length: pillCount }).map((_, i) => {
            const isFilled = i < usedSeats
            const isOverage = i >= totalSeats
            return (
              <div
                key={i}
                className={cn(
                  'h-[6px] flex-1 rounded-full transition-colors',
                  isOverage
                    ? 'bg-[var(--badge-amber-text)]'
                    : isFilled
                      ? 'bg-[var(--indicator-seat-filled)]'
                      : 'bg-[var(--border)]'
                )}
              />
            )
          })}
        </div>

        <p className='text-[var(--text-muted)] text-small'>
          {isOverLimit
            ? 'You have more teammates than seats. Contact support to adjust your enterprise seat count.'
            : 'Contact support for enterprise seat changes.'}
        </p>
      </div>
    </SettingsSection>
  )
}
