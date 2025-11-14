import { Badge, Button } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { cn } from '@/lib/utils'

const PILL_COUNT = 8

type Subscription = {
  id: string
  plan: string
  status: string
  seats?: number
  referenceId: string
  cancelAtPeriodEnd?: boolean
  periodEnd?: number | Date
  trialEnd?: number | Date
  metadata?: any
}

interface TeamSeatsOverviewProps {
  subscriptionData: Subscription | null
  isLoadingSubscription: boolean
  usedSeats: number
  isLoading: boolean
  onConfirmTeamUpgrade: (seats: number) => Promise<void>
  onReduceSeats: () => Promise<void>
  onAddSeatDialog: () => void
}

function TeamSeatsSkeleton() {
  return (
    <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-5 w-16' />
            <Skeleton className='h-4 w-20' />
          </div>
          <div className='flex items-center gap-1 text-xs'>
            <Skeleton className='h-4 w-8' />
            <span className='text-muted-foreground'>/</span>
            <Skeleton className='h-4 w-8' />
          </div>
        </div>
        <Skeleton className='h-2 w-full rounded' />
        <div className='flex gap-2 pt-1'>
          <Skeleton className='h-8 flex-1 rounded-[8px]' />
          <Skeleton className='h-8 flex-1 rounded-[8px]' />
        </div>
      </div>
    </div>
  )
}

export function TeamSeatsOverview({
  subscriptionData,
  isLoadingSubscription,
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
      <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
        <div className='space-y-3 text-center'>
          <div className='space-y-2'>
            <p className='font-medium text-sm'>No Team Subscription Found</p>
            <p className='text-muted-foreground text-xs'>
              Your subscription may need to be transferred to this organization.
            </p>
          </div>
          <Button
            variant='primary'
            onClick={() => {
              onConfirmTeamUpgrade(2) // Start with 2 seats as default
            }}
            disabled={isLoading}
          >
            Set Up Team Subscription
          </Button>
        </div>
      </div>
    )
  }

  const totalSeats = subscriptionData.seats || 0
  const isEnterprise = checkEnterprisePlan(subscriptionData)

  return (
    <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        {/* Top row - matching UsageHeader */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-[#FFFFFF] text-[12px]'>Seats</span>
            {!isEnterprise && (
              <Badge
                className='gradient-text h-[1.125rem] cursor-pointer rounded-[6px] border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs'
                onClick={onAddSeatDialog}
              >
                Add Seats
              </Badge>
            )}
          </div>
          <div className='flex items-center gap-[4px] text-xs tabular-nums'>
            <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
              {usedSeats} used
            </span>
            <span className='font-medium text-[#B1B1B1] text-[12px]'>/</span>
            <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
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
                  isFilled ? 'bg-[#34B5FF]' : 'bg-[#2C2C2C]'
                )}
              />
            )
          })}
        </div>

        {/* Enterprise message */}
        {isEnterprise && (
          <div className='pt-1 text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact support for enterprise usage limit changes
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
