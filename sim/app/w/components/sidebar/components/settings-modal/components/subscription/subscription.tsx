import { useState, useEffect, useMemo } from 'react'
import { client, useSession, useActiveOrganization, useSubscription } from '@/lib/auth-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Subscription')

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
  cachedIsPro?: boolean
  cachedIsTeam?: boolean
  cachedUsageData?: any
  cachedSubscriptionData?: any
  isLoading?: boolean
}

const useSubscriptionData = (
  userId: string | null | undefined, 
  activeOrgId: string | null | undefined,
  cachedIsPro?: boolean,
  cachedIsTeam?: boolean,
  cachedUsageData?: any,
  cachedSubscriptionData?: any,
  isParentLoading?: boolean
) => {
  const [isPro, setIsPro] = useState<boolean>(cachedIsPro || false)
  const [isTeam, setIsTeam] = useState<boolean>(cachedIsTeam || false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    currentUsage: number
    limit: number
  }>(cachedUsageData || {
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    currentUsage: 0,
    limit: 0
  })
  const [subscriptionData, setSubscriptionData] = useState<any>(cachedSubscriptionData || null)
  const [loading, setLoading] = useState<boolean>(isParentLoading !== undefined ? isParentLoading : true)
  const [error, setError] = useState<string | null>(null)
  const subscription = useSubscription()

  useEffect(() => {
    if (
      isParentLoading !== undefined || 
      (cachedIsPro !== undefined && 
       cachedIsTeam !== undefined && 
       cachedUsageData && 
       cachedSubscriptionData)
    ) {
      if (cachedIsPro !== undefined) setIsPro(cachedIsPro)
      if (cachedIsTeam !== undefined) setIsTeam(cachedIsTeam)
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
          fetch('/api/user/usage')
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
        
        const usageDataResponse = await usageResponse.json()
        setUsageData(usageDataResponse)
        
        logger.info('Subscription status and usage data retrieved', { 
          isPro: proStatusData.isPro, 
          isTeam: proStatusData.isTeam,
          usage: usageDataResponse
        })
        
        // Main subscription logic - prioritize organization team subscription
        let activeSubscription = null
        
        // First check if user has an active organization with a team subscription
        if (activeOrgId) {
          logger.info('Checking organization subscription first', { orgId: activeOrgId })
          
          // Get the organization's subscription
          const result = await subscription.list({
            query: { referenceId: activeOrgId }
          })
          
          const orgSubscriptions = result.data
          const orgSubError = 'error' in result ? result.error : null
          
          if (orgSubError) {
            logger.error('Error fetching organization subscription details', orgSubError)
          } else if (orgSubscriptions) {
            // Find active team subscription for the organization
            activeSubscription = orgSubscriptions.find(
              sub => sub.status === 'active' && sub.plan === 'team'
            )
            
            if (activeSubscription) {
              logger.info('Using organization team subscription as primary', {
                id: activeSubscription.id,
                seats: activeSubscription.seats
              })
            }
          }
        }
        
        // If no org team subscription was found, check for personal subscription
        if (!activeSubscription) {
          // Fetch detailed subscription data for the user
          const result = await subscription.list()
          
          const userSubscriptions = result.data
          const userSubError = 'error' in result ? result.error : null
          
          if (userSubError) {
            logger.error('Error fetching user subscription details', userSubError)
          } else if (userSubscriptions) {
            // Find active subscription for the user
            activeSubscription = userSubscriptions.find(
              sub => sub.status === 'active'
            )
          }
        }
        
        if (activeSubscription) {
          logger.info('Using active subscription', { 
            id: activeSubscription.id,
            plan: activeSubscription.plan,
            status: activeSubscription.status
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
  }, [userId, activeOrgId, subscription, cachedIsPro, cachedIsTeam, cachedUsageData, cachedSubscriptionData, isParentLoading])

  return { isPro, isTeam, usageData, subscriptionData, loading, error }
}

export function Subscription({
  onOpenChange,
  cachedIsPro,
  cachedIsTeam,
  cachedUsageData,
  cachedSubscriptionData,
  isLoading
}: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const subscription = useSubscription()
  
  const { 
    isPro, 
    isTeam, 
    usageData, 
    subscriptionData, 
    loading, 
    error: subscriptionError 
  } = useSubscriptionData(
    session?.user?.id, 
    activeOrg?.id,
    cachedIsPro,
    cachedIsTeam,
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
            You've used {usageData.percentUsed}% of your free tier limit 
            ({usageData.currentUsage.toFixed(2)}$ of {usageData.limit}$).
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
            <div className={`border rounded-lg p-4 ${!isPro ? 'border-primary' : ''}`}>
              <h4 className="text-md font-semibold">Free Tier</h4>
              <p className="text-sm text-muted-foreground mt-1">For individual users and small projects</p>
              
              <ul className="mt-3 space-y-2 text-sm">
                <li>• ${!isPro ? 5 : usageData.limit} of inference credits</li>
                <li>• Basic features</li>
                <li>• No sharing capabilities</li>
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
                      : ''
                    }`}
                  />
                </div>
              )}
              
              <div className="mt-4">
                {!isPro ? (
                  <div className="text-sm bg-secondary/50 text-secondary-foreground py-1 px-2 rounded inline-block">
                    Current Plan
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleCancel}
                    disabled={isCanceling}
                  >
                    {isCanceling ? <ButtonSkeleton /> : (
                      <span>Downgrade</span>
                    )}
                  </Button>
                )}
              </div>
            </div>
            
            {/* Pro Tier */}
            <div className={`border rounded-lg p-4 ${isPro && !isTeam ? 'border-primary' : ''}`}>
              <h4 className="text-md font-semibold">Pro Tier</h4>
              <p className="text-sm text-muted-foreground mt-1">For professional users and teams</p>
              
              <ul className="mt-3 space-y-2 text-sm">
                <li>• ${isPro && !isTeam ? usageData.limit : 20} of inference credits</li>
                <li>• All features included</li>
                <li>• Workflow sharing capabilities</li>
              </ul>
              
              {isPro && !isTeam && (
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
                      : ''
                    }`}
                  />
                </div>
              )}
              
              <div className="mt-4">
                {isPro && !isTeam ? (
                  <div className="text-sm bg-secondary/50 text-secondary-foreground py-1 px-2 rounded inline-block">
                    Current Plan
                  </div>
                ) : (
                  <Button 
                    variant={!isPro ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleUpgrade('pro')}
                    disabled={isUpgrading}
                  >
                    {isUpgrading ? <ButtonSkeleton /> : (
                      <span>{!isPro ? "Upgrade" : "Switch"}</span>
                    )}
                  </Button>
                )}
              </div>
            </div>
            
            {/* Team Tier */}
            <div className={`border rounded-lg p-4 ${isTeam ? 'border-primary' : ''}`}>
              <h4 className="text-md font-semibold">Team Tier</h4>
              <p className="text-sm text-muted-foreground mt-1">For collaborative teams</p>
              
              <ul className="mt-3 space-y-2 text-sm">
                <li>• $40 of inference credits per seat</li>
                <li>• All Pro features included</li>
                <li>• Real-time multiplayer collaboration</li>
                <li>• Shared workspace for team members</li>
              </ul>
              
              {isTeam && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Usage</span>
                    <span>
                      {usageData.currentUsage.toFixed(2)}$ / {(subscriptionData?.seats || 1) * 40}$
                    </span>
                  </div>
                  <Progress 
                    value={usageData.percentUsed} 
                    className={`h-2 ${
                      usageData.isExceeded 
                      ? 'bg-muted [&>*]:bg-destructive' 
                      : usageData.isWarning 
                      ? 'bg-muted [&>*]:bg-amber-500' 
                      : ''
                    }`}
                  />
                  
                  <div className="flex justify-between text-xs mt-2">
                    <span>Team Size</span>
                    <span>{subscriptionData?.seats || 1} {subscriptionData?.seats === 1 ? 'seat' : 'seats'}</span>
                  </div>
                </div>
              )}
              
              <div className="mt-4">
                {isTeam ? (
                  <div className="text-sm bg-secondary/50 text-secondary-foreground py-1 px-2 rounded inline-block">
                    Current Plan
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleTeamUpgrade}
                  >
                    Upgrade to Team
                  </Button>
                )}
              </div>
            </div>
            
            {/* Enterprise Tier */}
            <div className="border rounded-lg p-4 col-span-full">
              <h4 className="text-md font-semibold">Enterprise</h4>
              <p className="text-sm text-muted-foreground mt-1">For larger teams and organizations</p>
              
              <ul className="mt-3 space-y-2 text-sm">
                <li>• Custom cost limits</li>
                <li>• Priority support</li>
                <li>• Custom integrations</li>
                <li>• Dedicated account manager</li>
              </ul>
              
              <div className="mt-4">
                <Button 
                  variant="outline" 
                  size="sm"
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
                    <Button 
                      variant="outline" 
                      onClick={handleCancel} 
                      disabled={isCanceling}
                    >
                      {isCanceling ? <ButtonSkeleton /> : (
                        <span>Manage Subscription</span>
                      )}
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
                  Set up a team workspace with collaborative features. Each seat costs $40/month and gets $40 of inference credits.
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
                  Your team will have {seats} {seats === 1 ? 'seat' : 'seats'} with a total of ${seats * 40} inference credits per month.
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
                <Button
                  onClick={confirmTeamUpgrade}
                  disabled={isUpgradingTeam}
                >
                  {isUpgradingTeam ? <ButtonSkeleton /> : (
                    <span>Upgrade to Team Plan</span>
                  )}
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