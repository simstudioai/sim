import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
  cachedIsPro?: boolean
  cachedIsTeam?: boolean
  cachedIsEnterprise?: boolean
  cachedUsageData?: any
  cachedSubscriptionData?: any
  isLoading?: boolean
}

const useSubscriptionData = (
  userId: string | null | undefined,
  activeOrgId: string | null | undefined,
  cachedIsPro?: boolean,
  cachedIsTeam?: boolean,
  cachedIsEnterprise?: boolean,
  cachedUsageData?: any,
  cachedSubscriptionData?: any,
  isParentLoading?: boolean
) => {
  const [isPro, setIsPro] = useState<boolean>(cachedIsPro || false)
  const [isTeam, setIsTeam] = useState<boolean>(cachedIsTeam || false)
  const [isEnterprise, setIsEnterprise] = useState<boolean>(cachedIsEnterprise || false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    currentUsage: number
    limit: number
  }>(
    cachedUsageData || {
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      currentUsage: 0,
      limit: 0,
    }
  )
  const [subscriptionData, setSubscriptionData] = useState<any>(cachedSubscriptionData || null)
  const [loading, setLoading] = useState<boolean>(
    isParentLoading !== undefined ? isParentLoading : true
  )
  const [error, setError] = useState<string | null>(null)
  const subscription = useSubscription()

  useEffect(() => {
    if (
      isParentLoading !== undefined ||
      (cachedIsPro !== undefined &&
        cachedIsTeam !== undefined &&
        cachedIsEnterprise !== undefined &&
        cachedUsageData &&
        cachedSubscriptionData)
    ) {
      if (cachedIsPro !== undefined) setIsPro(cachedIsPro)
      if (cachedIsTeam !== undefined) setIsTeam(cachedIsTeam)
      if (cachedIsEnterprise !== undefined) setIsEnterprise(cachedIsEnterprise)
      if (cachedUsageData) setUsageData(cachedUsageData)
      if (cachedSubscriptionData) setSubscriptionData(cachedSubscriptionData)
      if (isParentLoading !== undefined) setLoading(isParentLoading)
      return
    }

    async function loadSubscriptionData() {
      if (!userId) return

      try {
        setLoading(true)
        setError(null)

        // Fetch subscription status and usage data in parallel
        const [proStatusResponse, usageResponse] = await Promise.all([
          fetch('/api/user/subscription'),
          fetch('/api/user/usage'),
        ])

        if (!proStatusResponse.ok) {
          throw new Error('Failed to fetch subscription status')
        }
        if (!usageResponse.ok) {
          throw new Error('Failed to fetch usage data')
        }

        // Process the responses
        const proStatusData = await proStatusResponse.json()
        setIsPro(proStatusData.isPro)
        setIsTeam(proStatusData.isTeam)
        setIsEnterprise(proStatusData.isEnterprise)

        const usageDataResponse = await usageResponse.json()
        setUsageData(usageDataResponse)

        logger.info('Subscription status and usage data retrieved', {
          isPro: proStatusData.isPro,
          isTeam: proStatusData.isTeam,
          isEnterprise: proStatusData.isEnterprise,
          usage: usageDataResponse,
        })

        // Main subscription logic - prioritize organization team/enterprise subscription
        let activeSubscription = null

        // First check if user has an active organization with a team/enterprise subscription
        if (activeOrgId) {
          logger.info('Checking organization subscription first', { orgId: activeOrgId })

          // Get the organization's subscription
          const result = await subscription.list({
            query: { referenceId: activeOrgId },
          })

          const orgSubscriptions = result.data
          const orgSubError = 'error' in result ? result.error : null

          if (orgSubError) {
            logger.error('Error fetching organization subscription details', orgSubError)
          } else if (orgSubscriptions) {
            // Find active team/enterprise subscription for the organization
            activeSubscription = orgSubscriptions.find(
              (sub) => sub.status === 'active' && (sub.plan === 'team' || sub.plan === 'enterprise')
            )

            if (activeSubscription) {
              logger.info(`Using organization ${activeSubscription.plan} subscription as primary`, {
                id: activeSubscription.id,
                seats: activeSubscription.seats,
              })
            }
          }
        }

        // If no org subscription was found, check for personal subscription
        if (!activeSubscription) {
          // Fetch detailed subscription data for the user
          const result = await subscription.list()

          const userSubscriptions = result.data
          const userSubError = 'error' in result ? result.error : null

          if (userSubError) {
            logger.error('Error fetching user subscription details', userSubError)
          } else if (userSubscriptions) {
            // Find active subscription for the user
            activeSubscription = userSubscriptions.find((sub) => sub.status === 'active')
          }
        }

        // If no subscription found via client.subscription but we know they have enterprise,
        // try fetching from the enterprise endpoint
        if (!activeSubscription && proStatusData.isEnterprise) {
          try {
            const enterpriseResponse = await fetch('/api/user/subscription/enterprise')
            if (enterpriseResponse.ok) {
              const enterpriseData = await enterpriseResponse.json()
              if (enterpriseData.subscription) {
                activeSubscription = enterpriseData.subscription
                logger.info('Found enterprise subscription', {
                  id: activeSubscription.id,
                  plan: 'enterprise',
                  seats: activeSubscription.seats,
                })
              }
            }
          } catch (error) {
            logger.error('Error fetching enterprise subscription details', error)
          }
        }

        if (activeSubscription) {
          logger.info('Using active subscription', {
            id: activeSubscription.id,
            plan: activeSubscription.plan,
            status: activeSubscription.status,
          })

          setSubscriptionData(activeSubscription)
        } else {
          logger.warn('No active subscription found')
        }
      } catch (error) {
        logger.error('Error checking subscription status:', error)
        setError('Failed to load subscription data')
      } finally {
        setLoading(false)
      }
    }

    loadSubscriptionData()
  }, [
    userId,
    activeOrgId,
    subscription,
    cachedIsPro,
    cachedIsTeam,
    cachedIsEnterprise,
    cachedUsageData,
    cachedSubscriptionData,
    isParentLoading,
  ])

  return { isPro, isTeam, isEnterprise, usageData, subscriptionData, loading, error }
}

export function Subscription({
  onOpenChange,
  cachedIsPro,
  cachedIsTeam,
  cachedIsEnterprise,
  cachedUsageData,
  cachedSubscriptionData,
  isLoading,
}: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const subscription = useSubscription()

  const {
    isPro,
    isTeam,
    isEnterprise,
    usageData,
    subscriptionData,
    loading,
    error: subscriptionError,
  } = useSubscriptionData(
    session?.user?.id,
    activeOrg?.id,
    cachedIsPro,
    cachedIsTeam,
    cachedIsEnterprise,
    cachedUsageData,
    cachedSubscriptionData,
    isLoading
  )

  const [isCanceling, setIsCanceling] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState<boolean>(false)
  const [seats, setSeats] = useState<number>(1)
  const [isUpgradingTeam, setIsUpgradingTeam] = useState<boolean>(false)
  const [isUpgrading, setIsUpgrading] = useState<boolean>(false)

  // Set error from subscription hook if there is one
  useEffect(() => {
    if (subscriptionError) {
      setError(subscriptionError)
    }
  }, [subscriptionError])

  const handleUpgrade = async (plan: string) => {
    if (!session?.user) {
      setError('You need to be logged in to upgrade your subscription')
      return
    }

    setIsUpgrading(true)
    setError(null)

    try {
      const result = await subscription.upgrade({
        plan: plan,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })

      if ('error' in result && result.error) {
        setError(result.error.message || `There was an error upgrading to the ${plan} plan`)
        logger.error('Subscription upgrade error:', result.error)
      }
    } catch (error: any) {
      logger.error('Subscription upgrade exception:', error)
      setError(error.message || `There was an unexpected error upgrading to the ${plan} plan`)
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleCancel = async () => {
    if (!session?.user) {
      setError('You need to be logged in to cancel your subscription')
      return
    }

    setIsCanceling(true)
    setError(null)

    try {
      const result = await subscription.cancel({
        returnUrl: window.location.href,
      })

      if ('error' in result && result.error) {
        setError(result.error.message || 'There was an error canceling your subscription')
        logger.error('Subscription cancellation error:', result.error)
      }
    } catch (error: any) {
      logger.error('Subscription cancellation exception:', error)
      setError(error.message || 'There was an unexpected error canceling your subscription')
    } finally {
      setIsCanceling(false)
    }
  }

  const handleTeamUpgrade = () => {
    setIsTeamDialogOpen(true)
  }

  const confirmTeamUpgrade = async () => {
    if (!session?.user) {
      setError('You need to be logged in to upgrade your team subscription')
      return
    }

    setIsUpgradingTeam(true)
    setError(null)

    try {
      const result = await subscription.upgrade({
        plan: 'team',
        seats,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })

      if ('error' in result && result.error) {
        setError(result.error.message || 'There was an error upgrading to the team plan')
        logger.error('Team subscription upgrade error:', result.error)
      } else {
        // Close the dialog after successful upgrade
        setIsTeamDialogOpen(false)
      }
    } catch (error: any) {
      logger.error('Team subscription upgrade exception:', error)
      setError(error.message || 'There was an unexpected error upgrading to the team plan')
    } finally {
      setIsUpgradingTeam(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h3 className="text-lg font-medium">Subscription Plans</h3>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(usageData.isWarning || usageData.isExceeded) && !isPro && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{usageData.isExceeded ? 'Usage Limit Exceeded' : 'Usage Warning'}</AlertTitle>
          <AlertDescription>
            You've used {usageData.percentUsed}% of your free tier limit (
            {usageData.currentUsage.toFixed(2)}$ of {usageData.limit}$).
            {usageData.isExceeded
              ? ' You have exceeded your limit. Upgrade to Pro to continue using all features.'
              : ' Upgrade to Pro to avoid any service interruptions.'}
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <SubscriptionSkeleton />
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Free Tier */}
            <div
              className={`relative border rounded-lg transition-all ${
                !isPro
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-border hover:border-border/80 hover:bg-accent/20'
              }`}
            >
              {!isPro && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-sm font-medium">
                  Current Plan
                </div>
              )}
              <div className="p-5">
                <h4 className="text-base font-semibold flex items-center">Free Tier</h4>
                <p className="text-sm text-muted-foreground mt-1">For individual users</p>

                <div className="my-4 py-2 border-y">
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold">$0</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ${!isPro ? 5 : usageData.limit} inference credits included
                  </div>
                </div>

                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Basic features</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>No sharing capabilities</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>7 day log retention</span>
                  </li>
                </ul>

                {!isPro && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Usage</span>
                      <span>
                        {usageData.currentUsage.toFixed(2)}$ / {usageData.limit}$
                      </span>
                    </div>
                    <Progress
                      value={usageData.percentUsed}
                      className={`h-2 ${
                        usageData.isExceeded
                          ? 'bg-muted [&>*]:bg-destructive'
                          : usageData.isWarning
                            ? 'bg-muted [&>*]:bg-amber-500'
                            : '[&>*]:bg-primary'
                      }`}
                    />
                  </div>
                )}

                <div className="mt-5">
                  {!isPro ? (
                    <div className="w-full bg-primary/10 text-primary py-2 px-3 rounded text-center text-xs font-medium">
                      Current Plan
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleCancel}
                      disabled={isCanceling}
                    >
                      {isCanceling ? <ButtonSkeleton /> : <span>Downgrade</span>}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Pro Tier */}
            <div
              className={`relative border rounded-lg transition-all ${
                isPro && !isTeam && !isEnterprise
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-border hover:border-border/80 hover:bg-accent/20'
              }`}
            >
              {isPro && !isTeam && !isEnterprise && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-sm font-medium">
                  Current Plan
                </div>
              )}
              <div className="p-5">
                <h4 className="text-base font-semibold flex items-center">Pro Tier</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  For professional users and teams
                </p>

                <div className="my-4 py-2 border-y">
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold">$20</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ${isPro && !isTeam && !isEnterprise ? usageData.limit : 20} inference credits
                    included
                  </div>
                </div>

                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>All features included</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Workflow sharing capabilities</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Extended log retention</span>
                  </li>
                </ul>

                {isPro && !isTeam && !isEnterprise && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Usage</span>
                      <span>
                        {usageData.currentUsage.toFixed(2)}$ / {usageData.limit}$
                      </span>
                    </div>
                    <Progress
                      value={usageData.percentUsed}
                      className={`h-2 ${
                        usageData.isExceeded
                          ? 'bg-muted [&>*]:bg-destructive'
                          : usageData.isWarning
                            ? 'bg-muted [&>*]:bg-amber-500'
                            : '[&>*]:bg-primary'
                      }`}
                    />
                  </div>
                )}

                <div className="mt-5">
                  {isPro && !isTeam && !isEnterprise ? (
                    <div className="w-full bg-primary/10 text-primary py-2 px-3 rounded text-center text-xs font-medium">
                      Current Plan
                    </div>
                  ) : (
                    <Button
                      variant={!isPro ? 'default' : 'outline'}
                      size="sm"
                      className="w-full"
                      onClick={() => handleUpgrade('pro')}
                      disabled={isUpgrading || isEnterprise}
                    >
                      {isUpgrading ? (
                        <ButtonSkeleton />
                      ) : (
                        <span>{!isPro ? 'Upgrade' : 'Switch'}</span>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Team Tier */}
            <div
              className={`relative border rounded-lg transition-all ${
                isTeam
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-border hover:border-border/80 hover:bg-accent/20'
              }`}
            >
              {isTeam && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-sm font-medium">
                  Current Plan
                </div>
              )}
              <div className="p-5">
                <h4 className="text-base font-semibold flex items-center">Team Tier</h4>
                <p className="text-sm text-muted-foreground mt-1">For collaborative teams</p>

                <div className="my-4 py-2 border-y">
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold">$40</span>
                    <span className="text-muted-foreground text-sm">/seat/month</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    $40 inference credits per seat
                  </div>
                </div>

                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>All Pro features included</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Real-time multiplayer collaboration</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Shared workspace for team members</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-primary mr-2">•</span>
                    <span>Unlimited log retention</span>
                  </li>
                </ul>

                {isTeam && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Usage</span>
                      <span>
                        {usageData.currentUsage.toFixed(2)}$ / {(subscriptionData?.seats || 1) * 40}
                        $
                      </span>
                    </div>
                    <Progress
                      value={usageData.percentUsed}
                      className={`h-2 ${
                        usageData.isExceeded
                          ? 'bg-muted [&>*]:bg-destructive'
                          : usageData.isWarning
                            ? 'bg-muted [&>*]:bg-amber-500'
                            : '[&>*]:bg-primary'
                      }`}
                    />

                    <div className="flex justify-between text-xs mt-2">
                      <span>Team Size</span>
                      <span>
                        {subscriptionData?.seats || 1}{' '}
                        {subscriptionData?.seats === 1 ? 'seat' : 'seats'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  {isTeam ? (
                    <div className="w-full bg-primary/10 text-primary py-2 px-3 rounded text-center text-xs font-medium">
                      Current Plan
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleTeamUpgrade}
                    >
                      Upgrade to Team
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Enterprise Tier */}
            <div
              className={`relative border rounded-lg md:col-span-2 transition-all ${
                isEnterprise
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-border hover:border-border/80 hover:bg-accent/20'
              }`}
            >
              {isEnterprise && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-sm font-medium">
                  Current Plan
                </div>
              )}
              <div className="p-5">
                <div className="md:flex md:justify-between md:items-start">
                  <div className="md:flex-1">
                    <h4 className="text-base font-semibold">Enterprise</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      For larger teams and organizations
                    </p>

                    <div className="my-4 py-2 border-y md:mr-6">
                      <div className="text-3xl font-bold">Custom</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Contact us for custom pricing
                      </div>
                    </div>
                  </div>

                  <div className="md:flex-1">
                    <ul className="mt-3 space-y-2 text-sm">
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Custom cost limits</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Priority support</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Custom integrations</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Dedicated account manager</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>Unlimited log retention</span>
                      </li>
                      <li className="flex items-start">
                        <span className="text-primary mr-2">•</span>
                        <span>24/7 slack support</span>
                      </li>
                      {isEnterprise && subscriptionData?.metadata?.perSeatAllowance && (
                        <li className="flex items-start">
                          <span className="text-primary mr-2">•</span>
                          <span>
                            ${subscriptionData.metadata.perSeatAllowance} inference credits per seat
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>

                {isEnterprise && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Usage</span>
                      <span>
                        {usageData.currentUsage.toFixed(2)}$ / {usageData.limit}$
                      </span>
                    </div>
                    <Progress
                      value={usageData.percentUsed}
                      className={`h-2 ${
                        usageData.isExceeded
                          ? 'bg-muted [&>*]:bg-destructive'
                          : usageData.isWarning
                            ? 'bg-muted [&>*]:bg-amber-500'
                            : '[&>*]:bg-primary'
                      }`}
                    />

                    <div className="flex justify-between text-xs mt-2">
                      <span>Team Size</span>
                      <span>
                        {subscriptionData?.seats || 1}{' '}
                        {subscriptionData?.seats === 1 ? 'seat' : 'seats'}
                      </span>
                    </div>

                    {subscriptionData?.metadata?.totalAllowance && (
                      <div className="flex justify-between text-xs mt-2">
                        <span>Total Allowance</span>
                        <span>${subscriptionData.metadata.totalAllowance}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5">
                  {isEnterprise ? (
                    <div className="w-full bg-primary/10 text-primary py-2 px-3 rounded text-center text-xs font-medium">
                      Current Plan
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        window.open(
                          'https://calendly.com/emir-simstudio/15min',
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }}
                    >
                      Contact Us
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {subscriptionData && (
            <div className="mt-8 border-t pt-6">
              <h4 className="text-md font-medium mb-4">Subscription Details</h4>
              <div className="text-sm space-y-2">
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  <span className="capitalize">{subscriptionData.status}</span>
                </p>
                {subscriptionData.periodEnd && (
                  <p>
                    <span className="font-medium">Next billing date:</span>{' '}
                    {new Date(subscriptionData.periodEnd).toLocaleDateString()}
                  </p>
                )}
                {isPro && (
                  <div className="mt-4">
                    <Button variant="outline" onClick={handleCancel} disabled={isCanceling}>
                      {isCanceling ? <ButtonSkeleton /> : <span>Manage Subscription</span>}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <Dialog open={isTeamDialogOpen} onOpenChange={setIsTeamDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Team Subscription</DialogTitle>
                <DialogDescription>
                  Set up a team workspace with collaborative features. Each seat costs $40/month and
                  gets $40 of inference credits.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                <Label htmlFor="seats">Number of seats</Label>
                <Select
                  value={seats.toString()}
                  onValueChange={(value) => setSeats(parseInt(value))}
                >
                  <SelectTrigger id="seats">
                    <SelectValue placeholder="Select number of seats" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? 'seat' : 'seats'} (${num * 40}/month)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p className="mt-2 text-sm text-muted-foreground">
                  Your team will have {seats} {seats === 1 ? 'seat' : 'seats'} with a total of $
                  {seats * 40} inference credits per month.
                </p>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsTeamDialogOpen(false)}
                  disabled={isUpgradingTeam}
                >
                  Cancel
                </Button>
                <Button onClick={confirmTeamUpgrade} disabled={isUpgradingTeam}>
                  {isUpgradingTeam ? <ButtonSkeleton /> : <span>Upgrade to Team Plan</span>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

// Skeleton component for subscription loading state
function SubscriptionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Free Tier Skeleton */}
        <div className="border rounded-lg p-4">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-48 mb-4" />

          <div className="space-y-2 mt-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-44" />
          </div>

          <div className="mt-4">
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Pro Tier Skeleton */}
        <div className="border rounded-lg p-4">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-48 mb-4" />

          <div className="space-y-2 mt-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-44" />
          </div>

          <div className="mt-4">
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Team Tier Skeleton */}
        <div className="border rounded-lg p-4">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-48 mb-4" />

          <div className="space-y-2 mt-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-48" />
          </div>

          <div className="mt-4">
            <Skeleton className="h-9 w-32" />
          </div>
        </div>

        {/* Enterprise Tier Skeleton */}
        <div className="border rounded-lg p-4 col-span-full">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-48 mb-4" />

          <div className="space-y-2 mt-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-48" />
          </div>

          <div className="mt-4">
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Skeleton component for loading state in buttons
function ButtonSkeleton() {
  return <Skeleton className="h-9 w-24" />
}
