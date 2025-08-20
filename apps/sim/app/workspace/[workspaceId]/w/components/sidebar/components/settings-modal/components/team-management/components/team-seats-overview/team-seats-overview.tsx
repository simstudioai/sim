import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'

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
    <div className='flex items-center space-x-2'>
      <Skeleton className='h-4 w-4' />
      <Skeleton className='h-4 w-32' />
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
    return (
      <Card className='rounded-[8px] shadow-xs'>
        <CardHeader className='p-4 pb-3'>
          <CardTitle className='font-medium text-sm'>Team Seats Overview</CardTitle>
          <CardDescription>Manage your team's seat allocation and billing</CardDescription>
        </CardHeader>
        <CardContent className='p-4 pt-0'>
          <TeamSeatsSkeleton />
        </CardContent>
      </Card>
    )
  }

  if (!subscriptionData) {
    return (
      <Card className='rounded-[8px] shadow-xs'>
        <CardHeader className='p-4 pb-3'>
          <CardTitle className='font-medium text-sm'>Team Seats Overview</CardTitle>
          <CardDescription>Manage your team's seat allocation and billing</CardDescription>
        </CardHeader>
        <CardContent className='p-4 pt-0'>
          <div className='space-y-4 p-6 text-center'>
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
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className='rounded-[8px] shadow-xs'>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base'>Team Seats Overview</CardTitle>
        <CardDescription>Manage your team's seat allocation and billing</CardDescription>
      </CardHeader>
      <CardContent className='p-4 pt-0'>
        <div className='space-y-4'>
          <div className='grid grid-cols-3 gap-4 text-center'>
            <div className='space-y-1'>
              <p className='font-bold text-xl'>{subscriptionData.seats || 0}</p>
              <p className='text-muted-foreground text-xs'>Licensed Seats</p>
            </div>
            <div className='space-y-1'>
              <p className='font-bold text-xl'>{usedSeats}</p>
              <p className='text-muted-foreground text-xs'>Used Seats</p>
            </div>
            <div className='space-y-1'>
              <p className='font-bold text-xl'>{(subscriptionData.seats || 0) - usedSeats}</p>
              <p className='text-muted-foreground text-xs'>Available</p>
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex justify-between text-sm'>
              <span>Seat Usage</span>
              <span>
                {usedSeats} of {subscriptionData.seats || 0} seats
              </span>
            </div>
            <Progress value={(usedSeats / (subscriptionData.seats || 1)) * 100} className='h-2' />
          </div>

          <div className='flex items-center justify-between border-t pt-2 text-sm'>
            <span>Seat Cost:</span>
            <span className='font-semibold'>
              ${((subscriptionData.seats || 0) * 40).toFixed(2)}
            </span>
          </div>
          <div className='mt-2 text-muted-foreground text-xs'>
            Individual usage limits may vary. See Subscription tab for team totals.
          </div>

          {checkEnterprisePlan(subscriptionData) ? (
            <div className='rounded-[8px] bg-purple-50 p-4 text-center'>
              <p className='font-medium text-purple-700 text-sm'>Enterprise Plan</p>
              <p className='mt-1 text-purple-600 text-xs'>Contact support to modify seats</p>
            </div>
          ) : (
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={onReduceSeats}
                disabled={(subscriptionData.seats || 0) <= 1 || isLoading}
                className='h-9 flex-1 rounded-[8px]'
              >
                Remove Seat
              </Button>
              <Button
                size='sm'
                onClick={onAddSeatDialog}
                disabled={isLoading}
                className='h-9 flex-1 rounded-[8px]'
              >
                Add Seat
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
