import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { BillingSummary } from './components/billing-summary'
import { CancelSubscription } from './components/cancel-subscription'
import { TeamSeatsDialog } from './components/team-seats-dialog'
import { UsageLimitEditor } from './components/usage-limit-editor'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()

  const {
    isLoading,
    error,
    getSubscriptionStatus,
    getUsage,
    getBillingStatus,
    usageLimitData,
    subscriptionData,
  } = useSubscriptionStore()

  const {
    activeOrganization,
    organizationBillingData,
    isLoadingOrgBilling,
    loadOrganizationBillingData,
    getUserRole,
    addSeats,
  } = useOrganizationStore()

  const [isSeatsDialogOpen, setIsSeatsDialogOpen] = useState(false)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  const subscription = getSubscriptionStatus()
  const usage = getUsage()
  const billingStatus = getBillingStatus()
  const activeOrgId = activeOrganization?.id

  useEffect(() => {
    if (subscription.isTeam && activeOrgId) {
      loadOrganizationBillingData(activeOrgId)
    }
  }, [activeOrgId, subscription.isTeam])

  // Determine if user is team admin/owner
  const userRole = getUserRole(session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)
  const shouldShowOrgBilling = subscription.isTeam && isTeamAdmin && organizationBillingData

  const handleUpgrade = useCallback(
    async (targetPlan: 'pro' | 'team') => {
      if (!session?.user?.id) return

      // Get current subscription data including stripeSubscriptionId
      const subscriptionData = useSubscriptionStore.getState().subscriptionData
      const currentSubscriptionId = subscriptionData?.stripeSubscriptionId

      let referenceId = session.user.id
      if (subscription.isTeam && activeOrgId) {
        referenceId = activeOrgId
      }

      const currentUrl = window.location.origin + window.location.pathname

      try {
        const upgradeParams: any = {
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          seats: targetPlan === 'team' ? 1 : undefined,
        }

        // Add subscriptionId if we have an existing subscription to ensure proper plan switching
        if (currentSubscriptionId) {
          upgradeParams.subscriptionId = currentSubscriptionId
          logger.info('Upgrading existing subscription', {
            targetPlan,
            currentSubscriptionId,
            referenceId,
          })
        } else {
          logger.info('Creating new subscription (no existing subscription found)', {
            targetPlan,
            referenceId,
          })
        }

        await betterAuthSubscription.upgrade(upgradeParams)
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)
        alert('Failed to initiate upgrade. Please try again or contact support.')
      }
    },
    [session?.user?.id, subscription.isTeam, activeOrgId, betterAuthSubscription]
  )

  const handleSeatsUpdate = useCallback(
    async (seats: number) => {
      if (!activeOrgId) {
        logger.error('No active organization found for seat update')
        return
      }

      try {
        setIsUpdatingSeats(true)
        await addSeats(seats)
        setIsSeatsDialogOpen(false)
      } catch (error) {
        logger.error('Failed to update seats:', error)
      } finally {
        setIsUpdatingSeats(false)
      }
    },
    [activeOrgId]
  )

  if (isLoading) {
    return (
      <div className='space-y-4 p-6'>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-4 w-3/4' />
      </div>
    )
  }

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

  return (
    <div className='p-6'>
      <div className='space-y-6'>
        {/* Current Plan & Usage Overview */}
        <div>
          <div className='mb-2 flex items-center justify-between'>
            <h3 className='font-medium text-sm'>Current Plan</h3>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-sm capitalize'>
                {subscription.plan} Plan
              </span>
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

        {/* Usage Limit Editor */}
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
              />
            )}
          </div>
          {subscription.isFree && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Upgrade to Pro ($20 minimum) or Team ($40 minimum) to customize your usage limit.
            </p>
          )}
          {subscription.isPro && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Pro plan minimum: $20. You can set your individual limit higher.
            </p>
          )}
          {subscription.isTeam && !isTeamAdmin && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Contact your team owner to adjust your limit. Team plan minimum: $40.
            </p>
          )}
          {subscription.isTeam && isTeamAdmin && (
            <p className='mt-1 text-muted-foreground text-xs'>
              Team plan minimum: $40 per member. Manage team member limits in the Team tab.
            </p>
          )}
        </div>

        {/* Team Management */}
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
                  {/* Team Summary */}
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground text-sm'>Licensed Seats</span>
                      <span className='font-semibold'>
                        {organizationBillingData.totalSeats} seats
                      </span>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground text-sm'>Monthly Bill</span>
                      <span className='font-semibold'>
                        ${organizationBillingData.totalSeats * 40}
                      </span>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-muted-foreground text-sm'>Current Usage</span>
                      <span className='font-semibold'>
                        ${organizationBillingData.totalCurrentUsage?.toFixed(2) || 0}
                      </span>
                    </div>
                  </div>

                  {/* Simple Explanation */}
                  <div className='rounded-lg bg-muted/50 p-3 text-muted-foreground text-sm'>
                    <p>
                      You pay ${organizationBillingData.totalSeats * 40}/month for{' '}
                      {organizationBillingData.totalSeats} licensed seats, regardless of usage. If
                      your team uses more than ${organizationBillingData.totalSeats * 40}, you'll be
                      charged for the overage.
                    </p>
                  </div>
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

        {/* Cancel Subscription */}
        <CancelSubscription
          subscription={{
            plan: subscription.plan,
            status: subscription.status,
            isPaid: subscription.isPaid,
          }}
          subscriptionData={{
            periodEnd: subscriptionData?.periodEnd || null,
          }}
        />

        {/* Team Seats Dialog */}
        <TeamSeatsDialog
          open={isSeatsDialogOpen}
          onOpenChange={setIsSeatsDialogOpen}
          title='Update Team Seats'
          description='Each seat costs $40/month and provides $40 in monthly inference credits. Adjust the number of licensed seats for your team.'
          currentSeats={
            shouldShowOrgBilling
              ? organizationBillingData?.totalSeats || 1
              : subscription.seats || 1
          }
          initialSeats={
            shouldShowOrgBilling
              ? organizationBillingData?.totalSeats || 1
              : subscription.seats || 1
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
