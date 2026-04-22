import { useParams, useRouter } from 'next/navigation'
import { Badge, Button, Skeleton } from '@/components/emcn'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { cn } from '@/lib/core/utils/cn'

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
  usedSeats: number
  isLoading: boolean
  onAddSeatDialog: () => void
}

function TeamSeatsSkeleton() {
  return (
    <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex flex-col gap-2 px-3.5 py-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-5 w-16 rounded-sm' />
            <Skeleton className='h-4 w-20 rounded-sm' />
          </div>
          <div className='flex items-center gap-1 text-small'>
            <Skeleton className='h-4 w-8 rounded-sm' />
            <span className='text-[var(--text-muted)]'>/</span>
            <Skeleton className='h-4 w-8 rounded-sm' />
          </div>
        </div>
        <Skeleton className='h-[6px] w-full rounded-full' />
      </div>
    </div>
  )
}

export function TeamSeatsOverview({
  subscriptionData,
  isLoadingSubscription,
  totalSeats,
  usedSeats,
  isLoading,
  onAddSeatDialog,
}: TeamSeatsOverviewProps) {
  const router = useRouter()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  if (isLoadingSubscription) {
    return <TeamSeatsSkeleton />
  }

  if (!subscriptionData) {
    return (
      <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
        <div className='flex flex-col items-center gap-3 px-3.5 py-4 text-center'>
          <div className='flex flex-col gap-1'>
            <p className='font-medium text-[var(--text-primary)] text-base'>
              No active Team subscription
            </p>
            <p className='text-[var(--text-muted)] text-small'>
              Purchase a Team plan to invite members and manage seats for this organization.
            </p>
          </div>
          <Button
            variant='primary'
            onClick={() => {
              if (workspaceId) {
                router.push(`/workspace/${workspaceId}/settings/subscription`)
              }
            }}
            disabled={isLoading || !workspaceId}
          >
            Go to subscription settings
          </Button>
        </div>
      </div>
    )
  }

  const isEnterprise = checkEnterprisePlan(subscriptionData)
  const isSeatDataPending = !isEnterprise && totalSeats === 0
  const isOverLimit = totalSeats > 0 && usedSeats > totalSeats
  const pillCount = Math.max(totalSeats, usedSeats)

  if (isSeatDataPending) {
    return <TeamSeatsSkeleton />
  }

  return (
    <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex flex-col gap-2 px-3.5 py-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Seats</span>
            {isOverLimit && (
              <Badge variant='amber' size='sm'>
                Over limit
              </Badge>
            )}
            {!isEnterprise && !isOverLimit && (
              <Badge
                variant='blue-secondary'
                size='sm'
                className='cursor-pointer'
                onClick={onAddSeatDialog}
              >
                Add Seats
              </Badge>
            )}
          </div>
          <div className='flex items-center gap-1 text-small tabular-nums'>
            <span className='font-medium text-[var(--text-secondary)] tabular-nums'>
              {usedSeats} used
            </span>
            <span className='font-medium text-[var(--text-secondary)]'>/</span>
            <span className='font-medium text-[var(--text-secondary)] tabular-nums'>
              {totalSeats} total
            </span>
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

        {isOverLimit && !isEnterprise && (
          <div className='flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-[var(--text-muted)] text-small'>
              You have more members than seats. New invites are paused until you add seats or remove
              members.
            </p>
            <Button variant='default' size='sm' onClick={onAddSeatDialog} disabled={isLoading}>
              Add seats
            </Button>
          </div>
        )}

        {isEnterprise && (
          <div className='pt-1 text-center'>
            <p className='text-[var(--text-muted)] text-small'>
              {isOverLimit
                ? 'You have more members than seats. Contact support to adjust your enterprise seat count.'
                : 'Contact support for enterprise usage limit changes'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
