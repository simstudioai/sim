import { useEffect, useState } from 'react'
import { AlertCircle, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { BillingSummary } from './components/billing-summary'
import { TeamSeatsDialog } from './components/team-seats-dialog'
import { UsageLimitEditor } from './components/usage-limit-editor'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const betterAuthSubscription = useSubscription()

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

  // Get organization billing data from store
  const orgBillingData = useSubscriptionStore((state) => state.getOrganizationBillingData())
  const isLoadingOrgBilling = useSubscriptionStore((state) => state.isLoadingOrgBilling)
  const userRole = useSubscriptionStore((state) => state.getUserRole())
  const loadOrganizationBillingData = useSubscriptionStore(
    (state) => state.loadOrganizationBillingData
  )

  // Get computed values
  const subscription = getSubscriptionStatus()
  const features = getFeatures()
  const usage = getUsage()
  const billingStatus = getBillingStatus()
  const remainingBudget = getRemainingBudget()
  const daysRemaining = getDaysRemainingInPeriod()

  // Debug logging - remove this after debugging
  useEffect(() => {
    logger.info('Subscription debug info', {
      subscription,
      usage,
      billingPeriodStart: usage.billingPeriodStart,
      billingPeriodEnd: usage.billingPeriodEnd,
      daysRemaining,
    })
  }, [subscription, usage, daysRemaining])

  // Load org billing data when component mounts or activeOrg changes
  useEffect(() => {
    if (subscription.isTeam && activeOrg?.id) {
      loadOrganizationBillingData(activeOrg.id)
    }
  }, [activeOrg?.id, subscription.isTeam, loadOrganizationBillingData])

  // Determine if user is team admin/owner
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)
  const shouldShowOrgBilling = subscription.isTeam && isTeamAdmin && orgBillingData

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

  const handleUpgrade = async (targetPlan: 'pro' | 'team') => {
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
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          seats: targetPlan === 'team' ? 1 : undefined,
        })
      } else {
        // Development fallback - log for debugging
        logger.warn('Stripe upgrade not available - development mode or missing configuration', {
          targetPlan,
          referenceId,
          betterAuthSubscription: typeof betterAuthSubscription,
        })

        // You might want to show a toast or alert to the user
        alert(
          `Upgrade to ${targetPlan} plan - Stripe integration not available in development mode`
        )
      }
    } catch (error) {
      logger.error('Failed to initiate subscription upgrade:', error)
      // You might want to show an error toast to the user
      alert('Failed to initiate upgrade. Please try again or contact support.')
    }
  }

  const handleLimitUpdated = async (newLimit: number) => {
    // Update the store state directly for immediate UI feedback
    try {
      await updateUsageLimit(newLimit)
      // Also refresh organization billing data to update team totals
      if (subscription.isTeam && activeOrg?.id) {
        await loadOrganizationBillingData(activeOrg.id)
      }
    } catch (error) {
      logger.error('Failed to update usage limit:', error)
    }
  }

  const handleSeatsUpdate = async (seats: number) => {
    if (!activeOrg?.id) {
      logger.error('No active organization found for seat update')
      return
    }

    try {
      setIsUpdatingSeats(true)

      const response = await fetch(`/api/organizations/${activeOrg.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seats }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update seats')
      }

      setIsSeatsDialogOpen(false)
      await Promise.all([refresh(), loadOrganizationBillingData(activeOrg.id)]) // Refresh both subscription and org billing data
    } catch (error) {
      logger.error('Failed to update seats:', error)
    } finally {
      setIsUpdatingSeats(false)
    }
  }

  return (
    <div className='p-6'>
      <div className='space-y-6'>
        {/* Current Plan & Usage Overview with Billing Summary */}
        <div>
          <div className='mb-2 flex items-center justify-between'>
            <h3 className='font-medium text-sm'>Current Plan</h3>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-sm capitalize'>
                {subscription.plan} Plan
              </span>
              {/* Billing Summary Badge - only show for paid plans */}
              {!subscription.isFree && <BillingSummary showDetails={false} />}
            </div>
          </div>

          <div className='mb-3 flex items-center justify-between'>
            <span className='font-semibold text-2xl'>
              ${usage.current.toFixed(2)} / ${usage.limit}
            </span>
            <div className='text-right'>
              <span className='block text-muted-foreground text-sm'>
                {usage.percentUsed}% used this period
              </span>
            </div>
          </div>
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

        {/* Usage Limit Editor - Show for all users */}
        <div>
          <div className='flex items-center justify-between'>
            <span className='font-medium text-sm'>
              {subscription.isTeam ? 'Individual Limit' : 'Monthly Limit'}
            </span>
            {isLoadingOrgBilling ? (
              <Skeleton className='h-8 w-16' />
            ) : (
              <UsageLimitEditor
                currentLimit={usageLimitData?.currentLimit ?? usage.limit}
                canEdit={
                  subscription.isPro ||
                  subscription.isTeam ||
                  subscription.isEnterprise ||
                  (subscription.isTeam && isTeamAdmin)
                }
                minimumLimit={usageLimitData?.minimumLimit ?? 5}
                onLimitUpdated={handleLimitUpdated}
              />
            )}
          </div>
          {subscription.isFree && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Upgrade to Pro or Team plan to customize your usage limit.
            </p>
          )}
          {subscription.isTeam && !isTeamAdmin && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Contact your team owner to adjust your limit.
            </p>
          )}
          {subscription.isTeam && isTeamAdmin && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Your individual usage limit. Manage team member limits in the Team tab.
            </p>
          )}
        </div>

        {/* Team Management - Enhanced */}
        {subscription.isTeam && (
          <div className='space-y-4'>
            {isLoadingOrgBilling ? (
              <Card>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <Skeleton className='h-5 w-5' />
                      <Skeleton className='h-6 w-24' />
                    </div>
                    <Skeleton className='h-8 w-24' />
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <div className='space-y-1'>
                      <Skeleton className='h-4 w-20' />
                      <Skeleton className='h-6 w-32' />
                    </div>
                    <div className='space-y-1 text-right'>
                      <Skeleton className='h-4 w-24' />
                      <Skeleton className='h-6 w-16' />
                    </div>
                  </div>
                  <Skeleton className='h-2 w-full' />
                </CardContent>
              </Card>
            ) : shouldShowOrgBilling ? (
              <Card>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <CardTitle className='flex items-center gap-2 text-lg'>
                      <Users className='h-5 w-5' />
                      Team Plan
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <div className='space-y-1'>
                      <p className='text-muted-foreground text-sm'>Team Seats</p>
                      <p className='font-semibold text-lg'>
                        {orgBillingData.usedSeats} of {orgBillingData.totalSeats} used
                      </p>
                    </div>
                    <div className='space-y-1 text-right'>
                      <p className='text-muted-foreground text-sm'>Total Usage Limit</p>
                      <p className='font-semibold text-lg'>
                        ${orgBillingData.totalUsageLimit.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <Progress
                    value={(orgBillingData.usedSeats / orgBillingData.totalSeats) * 100}
                    className='h-2'
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='flex items-center gap-2 text-lg'>
                    <Users className='h-5 w-5' />
                    Team Plan
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground text-sm'>Your monthly allowance</span>
                      <span className='font-semibold'>${usage.limit}</span>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      Contact your team owner to adjust your limit
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Upgrade Actions */}
        {subscription.isFree && (
          <div className='space-y-3'>
            <Button onClick={() => handleUpgrade('pro')} className='w-full'>
              Upgrade to Pro - $20/month
            </Button>
            <Button onClick={() => handleUpgrade('team')} variant='outline' className='w-full'>
              Upgrade to Team - $40/seat/month
            </Button>
            <div className='py-2 text-center'>
              <p className='text-muted-foreground text-xs'>
                Need a custom plan?{' '}
                <a
                  href='https://5fyxh22cfgi.typeform.com/to/EcJFBt9W'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 hover:underline'
                >
                  Contact us
                </a>{' '}
                for Enterprise pricing
              </p>
            </div>
          </div>
        )}

        {subscription.isPro && !subscription.isTeam && (
          <Button onClick={() => handleUpgrade('team')} className='w-full'>
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
          description='Each seat costs $40/month and provides $40 in monthly inference credits. Adjust the number of licensed seats for your team.'
          currentSeats={
            shouldShowOrgBilling ? orgBillingData?.totalSeats || 1 : subscription.seats || 1
          }
          initialSeats={
            shouldShowOrgBilling ? orgBillingData?.totalSeats || 1 : subscription.seats || 1
          }
          isLoading={isUpdatingSeats}
          onConfirm={handleSeatsUpdate}
          confirmButtonText='Update Seats'
          showCostBreakdown={true}
        />
      </div>
    </div>
  )
}
