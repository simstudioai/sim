import { Badge, Button } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
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
    <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex flex-col gap-[8px] px-[14px] py-[12px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Skeleton className='h-5 w-16 rounded-[4px]' />
            <Skeleton className='h-4 w-20 rounded-[4px]' />
          </div>
          <div className='flex items-center gap-[4px] text-[12px]'>
            <Skeleton className='h-4 w-8 rounded-[4px]' />
            <span className='text-[var(--text-muted)]'>/</span>
            <Skeleton className='h-4 w-8 rounded-[4px]' />
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
      <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
        <div className='flex flex-col items-center gap-[12px] px-[14px] py-[16px] text-center'>
          <div className='flex flex-col gap-[4px]'>
            <p className='font-medium text-[14px] text-[var(--text-primary)]'>
              No Team Subscription Found
            </p>
            <p className='text-[12px] text-[var(--text-muted)]'>
              Your subscription may need to be transferred to this organization.
            </p>
          </div>
          <Button
            variant='tertiary'
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
    <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex flex-col gap-[8px] px-[14px] py-[12px]'>
        {/* Top row - matching UsageHeader */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>Seats</span>
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
          <div className='flex items-center gap-[4px] text-[12px] tabular-nums'>
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
        <div className='flex items-center gap-[4px]'>
          {Array.from({ length: totalSeats }).map((_, i) => {
            const isFilled = i < usedSeats
            return (
              <div
                key={i}
                className={cn(
                  'h-[6px] flex-1 rounded-full transition-colors',
                  isFilled ? 'bg-[#34B5FF]' : 'bg-[var(--border)]'
                )}
              />
            )
          })}
        </div>

        {/* Enterprise message */}
        {isEnterprise && (
          <div className='pt-[4px] text-center'>
            <p className='text-[12px] text-[var(--text-muted)]'>
              Contact support for enterprise usage limit changes
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
