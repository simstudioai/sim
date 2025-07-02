import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubscriptionState, useUsageLimit } from '@/hooks/use-subscription-state'
import { TeamSeatsDialog } from './components/team-seats-dialog'
import { TeamUsageOverview } from './components/team-usage-overview'
import { UsageLimitEditor } from './components/usage-limit-editor'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

/**
 * Enhanced subscription component using consolidated subscription state management
 * Replaces the old complex state management with simple hooks
 */
export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const betterAuthSubscription = useSubscription()

  // Use consolidated hooks for all subscription data
  const subscriptionState = useSubscriptionState()
  const usageLimit = useUsageLimit()

  // Team seats dialog state
  const [isSeatsDialogOpen, setIsSeatsDialogOpen] = useState(false)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  // Handle loading state
  if (subscriptionState.isLoading || usageLimit.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-4 w-3/4' />
      </div>
    )
  }

  // Handle error state
  if (subscriptionState.error || usageLimit.error) {
    return (
      <Alert variant='destructive'>
        <AlertCircle className='h-4 w-4' />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load subscription data. Please try again.</AlertDescription>
      </Alert>
    )
  }

  const { subscription, features, usage } = subscriptionState
  const billingStatus = subscriptionState.getBillingStatus()
  const remainingBudget = subscriptionState.getRemainingBudget()
  const daysRemaining = subscriptionState.getDaysRemainingInPeriod()

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

  const handleLimitUpdated = (newLimit: number) => {
    // Refetch subscription state to get updated usage data
    subscriptionState.refetch()
    usageLimit.refetch()
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
      subscriptionState.refetch()
    } catch (error) {
      logger.error('Failed to update seats:', error)
    } finally {
      setIsUpdatingSeats(false)
    }
  }

  return (
    <div className='space-y-6'>
      {/* Current Plan Overview */}
      <div className='rounded-lg border bg-muted/20 p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h4 className='font-medium text-sm'>Current Plan</h4>
            <p className='text-muted-foreground text-xs capitalize'>{subscription.plan} Plan</p>
          </div>
          <div className='text-right'>
            <div className='font-medium text-sm'>
              ${usage.current.toFixed(2)} / ${usage.limit}
            </div>
            <p className='text-muted-foreground text-xs'>{usage.percentUsed}% used this period</p>
          </div>
        </div>

        {/* Usage Progress Bar */}
        <div className='mt-3'>
          <Progress
            value={usage.percentUsed}
            className={`h-2 ${billingStatus === 'exceeded' ? 'bg-destructive/20' : billingStatus === 'warning' ? 'bg-warning/20' : ''}`}
          />
        </div>

        {/* Billing Period Info */}
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
            You've exceeded your usage limit of ${usage.limit}. Please upgrade your plan or increase
            your limit.
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

      {/* Plan Features */}
      <div className='space-y-3'>
        <h4 className='font-medium text-sm'>Plan Features</h4>
        <div className='space-y-2 text-sm'>
          <div className='flex items-center justify-between'>
            <span>Sharing</span>
            <span className={features.sharingEnabled ? 'text-green-600' : 'text-muted-foreground'}>
              {features.sharingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span>Multiplayer</span>
            <span
              className={features.multiplayerEnabled ? 'text-green-600' : 'text-muted-foreground'}
            >
              {features.multiplayerEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span>Workspace Collaboration</span>
            <span
              className={
                features.workspaceCollaborationEnabled ? 'text-green-600' : 'text-muted-foreground'
              }
            >
              {features.workspaceCollaborationEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      {/* Usage Limit Management */}
      <div className='space-y-3'>
        <h4 className='font-medium text-sm'>Usage Limit</h4>
        <div className='flex items-center justify-between'>
          <span className='text-sm'>Monthly limit</span>
          <UsageLimitEditor
            currentLimit={usageLimit.currentLimit}
            canEdit={usageLimit.canEdit}
            minimumLimit={usageLimit.minimumLimit}
            onLimitUpdated={handleLimitUpdated}
          />
        </div>
        {!usageLimit.canEdit && subscription.isFree && (
          <p className='text-muted-foreground text-xs'>
            Upgrade to Pro or Team plan to customize your usage limit.
          </p>
        )}
        {usageLimit.setBy && usageLimit.setBy !== session?.user?.id && (
          <p className='text-muted-foreground text-xs'>
            Limit set by team administrator on {usageLimit.updatedAt?.toLocaleDateString()}.
          </p>
        )}
      </div>

      {/* Team Management */}
      {subscription.isTeam && (
        <div className='space-y-6'>
          <div className='space-y-3'>
            <h4 className='font-medium text-sm'>Team Subscription</h4>
            <Button variant='outline' onClick={() => setIsSeatsDialogOpen(true)}>
              Manage Seats ({subscription.seats || 1})
            </Button>
          </div>

          {/* Team Usage Overview - Only show if user is in an organization */}
          {activeOrg?.id && (
            <div className='space-y-3'>
              <h4 className='font-medium text-sm'>Team Usage Overview</h4>
              <TeamUsageOverview hasAdminAccess={true} />
            </div>
          )}
        </div>
      )}

      {/* Plan Actions */}
      <div className='space-y-3'>
        {subscription.isFree && (
          <Button onClick={handleUpgrade} className='w-full'>
            Upgrade to Pro - $20/month
          </Button>
        )}

        {subscription.isPro && !subscription.isTeam && (
          <Button onClick={handleUpgrade} className='w-full'>
            Upgrade to Team - $40/seat/month
          </Button>
        )}

        {subscription.isEnterprise && (
          <div className='text-center'>
            <p className='text-muted-foreground text-sm'>
              Enterprise plan - Contact support for changes
            </p>
          </div>
        )}
      </div>

      {/* Billing Insights */}
      {!subscription.isFree && (
        <div className='space-y-3'>
          <h4 className='font-medium text-sm'>Billing Insights</h4>
          <div className='space-y-2 text-sm'>
            <div className='flex items-center justify-between'>
              <span>Current period usage</span>
              <span>${usage.current.toFixed(2)}</span>
            </div>
            <div className='flex items-center justify-between'>
              <span>Remaining budget</span>
              <span className={remainingBudget > 0 ? 'text-green-600' : 'text-destructive'}>
                ${remainingBudget.toFixed(2)}
              </span>
            </div>
            {usage.lastPeriodCost > 0 && (
              <div className='flex items-center justify-between'>
                <span>Last period</span>
                <span>${usage.lastPeriodCost.toFixed(2)}</span>
              </div>
            )}
          </div>
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
  )
}
