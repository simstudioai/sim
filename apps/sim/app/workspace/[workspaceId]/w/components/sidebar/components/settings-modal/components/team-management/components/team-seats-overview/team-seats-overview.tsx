import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_TEAM_TIER_COST_LIMIT } from '@/lib/billing/constants'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/env'

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
        <div className='space-y-4 text-center'>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100'>
            <Building2 className='h-6 w-6 text-amber-600' />
          </div>
          <div className='space-y-2'>
            <p className='font-medium text-sm'>No Team Subscription Found</p>
            <p className='text-muted-foreground text-sm'>
              Your subscription may need to be transferred to this organization.
            </p>
          </div>
          <Button
            onClick={() => {
              onConfirmTeamUpgrade(2) // Start with 2 seats as default
            }}
            disabled={isLoading}
            className='h-9 rounded-[8px]'
          >
            Set Up Team Subscription
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        {/* Seats info and usage - matching team usage layout */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-sm'>Seats</span>
            {!checkEnterprisePlan(subscriptionData) ? (
              <span className='text-muted-foreground text-xs'>
                (${env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT}/month each)
              </span>
            ) : null}
          </div>
          <div className='flex items-center gap-1 text-xs tabular-nums'>
            <span className='text-muted-foreground'>{usedSeats} used</span>
            <span className='text-muted-foreground'>/</span>
            <span className='text-muted-foreground'>{subscriptionData.seats || 0} total</span>
          </div>
        </div>

        {/* Progress Bar - matching team usage component */}
        <Progress value={(usedSeats / (subscriptionData.seats || 1)) * 100} className='h-2' />

        {/* Action buttons - below the usage display */}
        {checkEnterprisePlan(subscriptionData) ? (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact support for enterprise usage limit changes
            </p>
          </div>
        ) : (
          <div className='flex gap-2 pt-1'>
            <Button
              variant='outline'
              size='sm'
              onClick={onReduceSeats}
              disabled={(subscriptionData.seats || 0) <= 1 || isLoading}
              className='h-8 flex-1 rounded-[8px]'
            >
              Remove Seat
            </Button>
            <Button
              size='sm'
              onClick={onAddSeatDialog}
              disabled={isLoading}
              className='h-8 flex-1 rounded-[8px]'
            >
              Add Seat
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
