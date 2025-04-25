import { useState, useEffect } from 'react'
import { client, useSession } from '@/lib/auth-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Progress } from '@/components/ui/progress'

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
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
          
          // Fetch usage data from API
          const usageResponse = await fetch('/api/user/usage')
          if (!usageResponse.ok) {
            throw new Error('Failed to fetch usage data')
          }
          const usageData = await usageResponse.json()
          setUsageData(usageData)
          
          // Fetch detailed subscription data
          const { data, error: subError } = await client.subscription.list()
          
          if (subError) {
            console.error('Error fetching subscription details', subError)
            // Continue with basic subscription info we already have
          } else {
            // Find active subscription
            const activeSubscription = data?.find(
              sub => sub.status === 'active'
            )
            setSubscriptionData(activeSubscription)
          }
        } catch (error) {
          console.error('Error checking subscription status:', error)
        } finally {
          setLoading(false)
        }
      }
    }
    
    checkSubscriptionStatus()
  }, [session?.user?.id])

  const handleUpgrade = async () => {
    if (!session?.user) {
      setError('You need to be logged in to upgrade your subscription')
      return
    }
    
    try {
      const { error } = await client.subscription.upgrade({
        plan: 'pro',
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })
      
      if (error) {
        setError(error.message || 'There was an error upgrading your subscription')
      }
    } catch (error: any) {
      setError(error.message || 'There was an error upgrading your subscription')
    }
  }

  const handleCancel = async () => {
    if (!session?.user) {
      setError('You need to be logged in to cancel your subscription')
      return
    }
    
    setIsCanceling(true)
    
    try {
      const { error } = await client.subscription.cancel({
        returnUrl: window.location.href,
      })
      
      if (error) {
        setError(error.message || 'There was an error canceling your subscription')
      }
    } catch (error: any) {
      setError(error.message || 'There was an error canceling your subscription')
    } finally {
      setIsCanceling(false)
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
            <div className={`border rounded-lg p-4 ${isPro ? 'border-primary' : ''}`}>
              <h4 className="text-md font-semibold">Pro Tier</h4>
              <p className="text-sm text-muted-foreground mt-1">For professional users and teams</p>
              
              <ul className="mt-3 space-y-2 text-sm">
                <li>• ${isPro ? usageData.limit : 20} of inference credits</li>
                <li>• All features included</li>
                <li>• Workflow sharing capabilities</li>
              </ul>
              
              {isPro && (
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
                {isPro ? (
                  <div className="text-sm bg-secondary/50 text-secondary-foreground py-1 px-2 rounded inline-block">
                    Current Plan
                  </div>
                ) : (
                  <Button 
                    variant="default" 
                    size="sm"
                    onClick={handleUpgrade}
                  >
                    Upgrade
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
        </>
      )}
    </div>
  )
} 