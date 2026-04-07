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
  onConfirmTeamUpgrade: (seats: number) => Promise<void>
  onReduceSeats: () => Promise<void>
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
  onConfirmTeamUpgrade,
  onReduceSeats,
  onAddSeatDialog,
}: TeamSeatsOverviewProps) {
  if (isLoadingSubscription) {
    return <TeamSeatsSkeleton />
  }

  if (!subscriptionData) {
    return (
      <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
        <div className='flex flex-col items-center gap-3 px-3.5 py-4 text-center'>
          <div className='flex flex-col gap-1'>
            <p className='font-medium text-[var(--text-primary)] text-base'>
              No Team Subscription Found
            </p>
            <p className='text-[var(--text-muted)] text-small'>
              Your subscription may need to be transferred to this organization.
            </p>
          </div>
          <Button
            variant='primary'
            onClick={() => {
              onConfirmTeamUpgrade(2)
            }}
            disabled={isLoading}
          >
            Set Up Team Subscription
          </Button>
        </div>
      </div>
    )
  }

  const isEnterprise = checkEnterprisePlan(subscriptionData)

  return (
    <div className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex flex-col gap-2 px-3.5 py-3'>
        {/* Top row - matching UsageHeader */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-[var(--text-primary)] text-base'>Seats</span>
            {!isEnterprise && (
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

        {/* Pills row - one pill per seat */}
        <div className='flex items-center gap-1'>
          {Array.from({ length: totalSeats }).map((_, i) => {
            const isFilled = i < usedSeats
            return (
              <div
                key={i}
                className={cn(
                  'h-[6px] flex-1 rounded-full transition-colors',
                  isFilled ? 'bg-[var(--indicator-seat-filled)]' : 'bg-[var(--border)]'
                )}
              />
            )
          })}
        </div>

        {/* Enterprise message */}
        {isEnterprise && (
          <div className='pt-1 text-center'>
            <p className='text-[var(--text-muted)] text-small'>
              Contact support for enterprise usage limit changes
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
