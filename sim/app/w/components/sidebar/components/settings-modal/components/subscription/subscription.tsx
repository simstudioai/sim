import { useState, useEffect } from 'react'
import { client, useSession, useActiveOrganization } from '@/lib/auth-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Progress } from '@/components/ui/progress'
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
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  
  const [isPro, setIsPro] = useState<boolean>(false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number;
    isWarning: boolean;
    isExceeded: boolean;
    currentUsage: number;
    limit: number;
  }>({
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    currentUsage: 0,
    limit: 0
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)
  const [isCanceling, setIsCanceling] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isTeam, setIsTeam] = useState<boolean>(false)
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState<boolean>(false)
  const [seats, setSeats] = useState<number>(1)
  const [isUpgradingTeam, setIsUpgradingTeam] = useState<boolean>(false)

  useEffect(() => {
    async function checkSubscriptionStatus() {
      if (session?.user?.id) {
        try {
          setLoading(true)
          setError(null)
          
          // Fetch subscription status from API
          const proStatusResponse = await fetch('/api/user/subscription')
          if (!proStatusResponse.ok) {
            throw new Error('Failed to fetch subscription status')
          }
          const proStatusData = await proStatusResponse.json()
          setIsPro(proStatusData.isPro)
          setIsTeam(proStatusData.isTeam)
          
          logger.info('Subscription status', { isPro: proStatusData.isPro, isTeam: proStatusData.isTeam })
          
          // Fetch usage data from API
          const usageResponse = await fetch('/api/user/usage')
          if (!usageResponse.ok) {
            throw new Error('Failed to fetch usage data')
          }
          const usageData = await usageResponse.json()
          logger.info('Usage data retrieved', usageData)
          setUsageData(usageData)
          
          // Main subscription logic - prioritize organization team subscription
          let activeSubscription = null
          
          // First check if user has an active organization with a team subscription
          if (activeOrg?.id) {
            logger.info('Checking organization subscription first', { 
              orgId: activeOrg.id, 
              orgName: activeOrg.name 
            })
            
            // Get the organization's subscription
            const { data: orgSubscriptions, error: orgSubError } = await client.subscription.list({
              query: { referenceId: activeOrg.id }
            })
            
            if (orgSubError) {
              logger.error('Error fetching organization subscription details', orgSubError)
            } else {
              logger.info('Organization subscriptions', { 
                orgId: activeOrg.id,
                subscriptionsCount: orgSubscriptions?.length || 0,
                subscriptions: orgSubscriptions?.map(s => ({
                  id: s.id,
                  plan: s.plan,
                  status: s.status,
                  seats: s.seats
                }))
              })
              
              // Find active team subscription for the organization
              activeSubscription = orgSubscriptions?.find(
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
            const { data: userSubscriptions, error: userSubError } = await client.subscription.list()
            
            if (userSubError) {
              logger.error('Error fetching user subscription details', userSubError)
            } else {
              // Find active subscription for the user
              activeSubscription = userSubscriptions?.find(
                sub => sub.status === 'active'
              )
              
              logger.info('User subscription data', { 
                found: !!activeSubscription, 
                subscriptions: userSubscriptions?.map(s => ({
                  id: s.id,
                  plan: s.plan,
                  status: s.status,
                  seats: s.seats
                }))
              })
            }
          }
          
          if (activeSubscription) {
            logger.info('Using active subscription', { 
              id: activeSubscription.id,
              plan: activeSubscription.plan,
              status: activeSubscription.status,
              seats: activeSubscription.seats,
              referenceId: activeSubscription.referenceId
            })
            
            setSubscriptionData(activeSubscription)
          } else {
            logger.warn('No active subscription found')
          }
        } catch (error) {
          logger.error('Error checking subscription status:', error)
        } finally {
          setLoading(false)
        }
      }
    }
    
    checkSubscriptionStatus()
  }, [session?.user?.id, activeOrg])

  const handleUpgrade = async (plan: string) => {
    if (!session?.user) {
      setError('You need to be logged in to upgrade your subscription')
      return
    }
    
    try {
      setError(null)
      
      const { error } = await client.subscription.upgrade({
        plan: plan,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })
      
      if (error) {
        setError(error.message || `There was an error upgrading to the ${plan} plan`)
        logger.error('Subscription upgrade error:', error)
      }
    } catch (error: any) {
      logger.error('Subscription upgrade exception:', error)
      setError(error.message || `There was an unexpected error upgrading to the ${plan} plan`)
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
      const { error } = await client.subscription.cancel({
        returnUrl: window.location.href,
      })
      
      if (error) {
        setError(error.message || 'There was an error canceling your subscription')
        logger.error('Subscription cancellation error:', error)
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
      const { error } = await client.subscription.upgrade({
        plan: 'team',
        successUrl: window.location.href,
        cancelUrl: window.location.href,
        seats: seats
      })
      
      if (error) {
        setError(error.message || 'There was an error upgrading to the team plan')
        logger.error('Team subscription upgrade error:', error)
      } else {
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
        <div className="flex items-center justify-center py-8">
          <LoadingAgent size="sm" />
          <span className="ml-2">Loading subscription details...</span>
        </div>
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
                    {isCanceling && <LoadingAgent size="sm" />}
                    <span className={isCanceling ? "ml-2" : ""}>Downgrade</span>
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
                  >
                    {!isPro ? "Upgrade" : "Switch"}
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
                      {isCanceling && <LoadingAgent size="sm" />}
                      <span className={isCanceling ? "ml-2" : ""}>Manage Subscription</span>
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
                  {isUpgradingTeam && <LoadingAgent size="sm" />}
                  <span className={isUpgradingTeam ? "ml-2" : ""}>
                    Upgrade to Team Plan
                  </span>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
} 