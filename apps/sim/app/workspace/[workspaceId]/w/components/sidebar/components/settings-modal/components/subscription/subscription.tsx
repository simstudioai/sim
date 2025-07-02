import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { TeamSeatsDialog } from './components/team-seats-dialog'
import { TeamUsageOverview } from './components/team-usage-overview'
import { UsageLimitEditor } from './components/usage-limit-editor'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

/**
 * Enhanced subscription component using subscription store for centralized state management
 * Eliminates duplicate API calls and provides cached data across components
 */
export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const betterAuthSubscription = useSubscription()

  // Use subscription store for all data
  const {
    isLoading,
    error,
    getSubscriptionStatus,
    getFeatures,
    getUsage,
    getBillingStatus,
    getRemainingBudget,
    getDaysRemainingInPeriod,
    usageLimitData,
    updateUsageLimit,
    refresh,
  } = useSubscriptionStore()

  // Team seats dialog state
  const [isSeatsDialogOpen, setIsSeatsDialogOpen] = useState(false)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  // Get computed values
  const subscription = getSubscriptionStatus()
  const features = getFeatures()
  const usage = getUsage()
  const billingStatus = getBillingStatus()
  const remainingBudget = getRemainingBudget()
  const daysRemaining = getDaysRemainingInPeriod()

  // Handle loading state
  if (isLoading) {
    return (
      <div className='space-y-4 p-6'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-4 w-3/4' />
      </div>
    )
  }

  // Handle error state
  if (error) {
    return (
      <div className='p-6'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const handleUpgrade = async () => {
    if (!session?.user?.id) return

    let referenceId = session.user.id
    if (subscription.isTeam && activeOrg?.id) {
      referenceId = activeOrg.id
    }

    const currentUrl = window.location.origin + window.location.pathname

    try {
      // Use the correct Better Auth subscription.upgrade method
      if (
        'upgrade' in betterAuthSubscription &&
        typeof betterAuthSubscription.upgrade === 'function'
      ) {
        await betterAuthSubscription.upgrade({
          plan: subscription.isFree ? 'pro' : 'team',
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          seats: subscription.isFree ? undefined : 1, // Default to 1 seat for team plan
        })
      } else {
        // Development fallback or manual upgrade flow
        logger.warn('Stripe upgrade not available - development mode or missing configuration')
      }
    } catch (error) {
      logger.error('Failed to initiate subscription upgrade:', error)
    }
  }

  const handleLimitUpdated = async (newLimit: number) => {
    try {
      const result = await updateUsageLimit(newLimit)
      if (!result.success) {
        logger.error('Failed to update usage limit:', result.error)
      }
    } catch (error) {
      logger.error('Failed to update usage limit:', error)
    }
  }

  const handleSeatsUpdate = async (seats: number) => {
    try {
      setIsUpdatingSeats(true)

      const response = await fetch('/api/subscription/update-seats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seats }),
      })

      if (!response.ok) {
        throw new Error('Failed to update seats')
      }

      setIsSeatsDialogOpen(false)
      await refresh() // Refresh subscription data
    } catch (error) {
      logger.error('Failed to update seats:', error)
    } finally {
      setIsUpdatingSeats(false)
    }
  }

  return (
    <div className='p-6'>
      <div className='space-y-6'>
        {/* Current Plan & Usage Overview - Keep at top */}
        <div>
          <div className='mb-2 flex items-center justify-between'>
            <h3 className='font-medium text-sm'>Current Plan</h3>
            <span className='text-muted-foreground text-sm capitalize'>
              {subscription.plan} Plan
            </span>
          </div>

          <div className='mb-3 flex items-center justify-between'>
            <span className='font-semibold text-2xl'>
              ${usage.current.toFixed(2)} / ${usage.limit}
            </span>
            <span className='text-muted-foreground text-sm'>
              {usage.percentUsed}% used this period
            </span>
          </div>

          <Progress
            value={usage.percentUsed}
            className={`h-2 ${billingStatus === 'exceeded' ? 'bg-destructive/20' : billingStatus === 'warning' ? 'bg-warning/20' : ''}`}
          />

          {usage.billingPeriodEnd && daysRemaining !== null && (
            <p className='mt-2 text-muted-foreground text-xs'>
              {daysRemaining} days remaining in current billing period
            </p>
          )}
        </div>

        {/* Usage Alerts */}
        {billingStatus === 'exceeded' && (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Usage Limit Exceeded</AlertTitle>
            <AlertDescription>
              You've exceeded your usage limit of ${usage.limit}. Please upgrade your plan or
              increase your limit.
            </AlertDescription>
          </Alert>
        )}

        {billingStatus === 'warning' && (
          <Alert>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Approaching Usage Limit</AlertTitle>
            <AlertDescription>
              You've used {usage.percentUsed}% of your ${usage.limit} limit. Consider upgrading or
              increasing your limit.
            </AlertDescription>
          </Alert>
        )}

        {/* Usage Limit Editor - Keep this */}
        <div>
          <div className='flex items-center justify-between'>
            <span className='font-medium text-sm'>Monthly limit</span>
            <UsageLimitEditor
              currentLimit={usageLimitData?.currentLimit ?? 5}
              canEdit={usageLimitData?.canEdit ?? false}
              minimumLimit={usageLimitData?.minimumLimit ?? 5}
              onLimitUpdated={handleLimitUpdated}
            />
          </div>
          {!usageLimitData?.canEdit && subscription.isFree && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Upgrade to Pro or Team plan to customize your usage limit.
            </p>
          )}
        </div>

        {/* Plan Features - Compact */}
        <div>
          <h4 className='mb-3 font-medium text-sm'>Plan Features</h4>
          <div className='grid grid-cols-3 gap-4 text-sm'>
            <div className='text-center'>
              <div
                className={`text-xs ${features.sharingEnabled ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {features.sharingEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div className='text-muted-foreground text-xs'>Sharing</div>
            </div>
            <div className='text-center'>
              <div
                className={`text-xs ${features.multiplayerEnabled ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {features.multiplayerEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div className='text-muted-foreground text-xs'>Multiplayer</div>
            </div>
            <div className='text-center'>
              <div
                className={`text-xs ${features.workspaceCollaborationEnabled ? 'text-green-600' : 'text-muted-foreground'}`}
              >
                {features.workspaceCollaborationEnabled ? 'Enabled' : 'Disabled'}
              </div>
              <div className='text-muted-foreground text-xs'>Collaboration</div>
            </div>
          </div>
        </div>

        {/* Team Management - Compact */}
        {subscription.isTeam && (
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h4 className='font-medium text-sm'>Team Subscription</h4>
              <Button variant='outline' size='sm' onClick={() => setIsSeatsDialogOpen(true)}>
                Manage Seats ({subscription.seats || 1})
              </Button>
            </div>

            {/* Team Usage Overview - Show if user is in an organization */}
            {activeOrg?.id && (
              <div className='mt-4'>
                <h5 className='mb-2 font-medium text-sm'>Team Usage Overview</h5>
                <TeamUsageOverview hasAdminAccess={true} />
              </div>
            )}
          </div>
        )}

        {/* Upgrade Actions */}
        {subscription.isFree && (
          <div className='space-y-3'>
            <Button onClick={handleUpgrade} className='w-full'>
              Upgrade to Pro - $20/month
            </Button>
            <Button
              onClick={() => {
                // Handle team upgrade for free users
                const handleTeamUpgrade = async () => {
                  if (!session?.user?.id) return

                  const currentUrl = window.location.origin + window.location.pathname

                  try {
                    if (
                      'upgrade' in betterAuthSubscription &&
                      typeof betterAuthSubscription.upgrade === 'function'
                    ) {
                      await betterAuthSubscription.upgrade({
                        plan: 'team',
                        referenceId: session.user.id,
                        successUrl: currentUrl,
                        cancelUrl: currentUrl,
                        seats: 1,
                      })
                    }
                  } catch (error) {
                    logger.error('Failed to initiate team upgrade:', error)
                  }
                }
                handleTeamUpgrade()
              }}
              variant='outline'
              className='w-full'
            >
              Upgrade to Team - $40/seat/month
            </Button>
            <div className='py-2 text-center'>
              <p className='text-muted-foreground text-xs'>
                Need a custom plan?{' '}
                <a href='mailto:support@simstudio.com' className='text-blue-500 hover:underline'>
                  Contact us
                </a>{' '}
                for Enterprise pricing
              </p>
            </div>
          </div>
        )}

        {subscription.isPro && !subscription.isTeam && (
          <Button onClick={handleUpgrade} className='w-full'>
            Upgrade to Team - $40/seat/month
          </Button>
        )}

        {subscription.isEnterprise && (
          <div className='py-2 text-center'>
            <p className='text-muted-foreground text-sm'>
              Enterprise plan - Contact support for changes
            </p>
          </div>
        )}

        {/* Team Seats Dialog */}
        <TeamSeatsDialog
          open={isSeatsDialogOpen}
          onOpenChange={setIsSeatsDialogOpen}
          title='Update Team Seats'
          description='Adjust the number of seats for your team subscription.'
          currentSeats={subscription.seats || 1}
          initialSeats={subscription.seats || 1}
          isLoading={isUpdatingSeats}
          onConfirm={handleSeatsUpdate}
          confirmButtonText='Update Seats'
          showCostBreakdown={true}
        />
      </div>
    </div>
  )
}
