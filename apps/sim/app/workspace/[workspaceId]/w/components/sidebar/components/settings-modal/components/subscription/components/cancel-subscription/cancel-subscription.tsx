'use client'

import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('CancelSubscription')

interface CancelSubscriptionProps {
  subscription: {
    plan: string
    status: string | null
    isPaid: boolean
  }
  subscriptionData?: {
    periodEnd?: Date | null
  }
}

export function CancelSubscription({ subscription, subscriptionData }: CancelSubscriptionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const { activeOrganization, loadOrganizationSubscription, refreshOrganization } =
    useOrganizationStore()
  const { getSubscriptionStatus, refresh } = useSubscriptionStore()

  // Clear error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Don't show for free plans
  if (!subscription.isPaid) {
    return null
  }

  const handleCancel = async () => {
    if (!session?.user?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const subscriptionStatus = getSubscriptionStatus()
      const activeOrgId = activeOrganization?.id

      let referenceId = session.user.id
      let subscriptionId: string | undefined

      if (subscriptionStatus.isTeam && activeOrgId) {
        referenceId = activeOrgId
        // Get subscription ID for team/enterprise
        const orgSubscription = useOrganizationStore.getState().subscriptionData
        subscriptionId = orgSubscription?.id
      }

      logger.info('Canceling subscription', {
        referenceId,
        subscriptionId,
        isTeam: subscriptionStatus.isTeam,
        activeOrgId,
      })

      if (!betterAuthSubscription.cancel) {
        throw new Error('Subscription management not available')
      }

      const returnUrl = window.location.origin + window.location.pathname.split('/w/')[0]

      const cancelParams: any = {
        returnUrl,
        referenceId,
      }

      if (subscriptionId) {
        cancelParams.subscriptionId = subscriptionId
      }

      const result = await betterAuthSubscription.cancel(cancelParams)

      if (result && 'error' in result && result.error) {
        setError(result.error.message || 'Failed to cancel subscription')
        logger.error('Failed to cancel subscription via Better Auth', { error: result.error })
      } else {
        logger.info('Redirecting to Stripe Billing Portal for cancellation')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cancel subscription'
      setError(errorMessage)
      logger.error('Failed to cancel subscription', { error })
    } finally {
      setIsLoading(false)
    }
  }
  const handleKeep = async () => {
    if (!session?.user?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const subscriptionStatus = getSubscriptionStatus()
      const activeOrgId = activeOrganization?.id

      // For team/enterprise plans, get the subscription ID from organization store
      if ((subscriptionStatus.isTeam || subscriptionStatus.isEnterprise) && activeOrgId) {
        const orgSubscription = useOrganizationStore.getState().subscriptionData

        if (orgSubscription?.id && orgSubscription?.cancelAtPeriodEnd) {
          // Restore the organization subscription
          if (!betterAuthSubscription.restore) {
            throw new Error('Subscription restore not available')
          }

          const result = await betterAuthSubscription.restore({
            referenceId: activeOrgId,
            subscriptionId: orgSubscription.id,
          })
          logger.info('Organization subscription restored successfully', result)
        }
      }

      // Refresh state and close
      await refresh()
      if (activeOrgId) {
        await loadOrganizationSubscription(activeOrgId)
        await refreshOrganization().catch(() => {})
      }
      setIsDialogOpen(false)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to keep subscription'
      setError(errorMessage)
      logger.error('Failed to keep subscription', { error })
    } finally {
      setIsLoading(false)
    }
  }
  const getPeriodEndDate = () => {
    return subscriptionData?.periodEnd || null
  }

  const formatDate = (date: Date | null) => {
    if (!date) return 'end of current billing period'

    try {
      // Ensure we have a valid Date object
      const dateObj = date instanceof Date ? date : new Date(date)

      // Check if the date is valid
      if (Number.isNaN(dateObj.getTime())) {
        return 'end of current billing period'
      }

      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(dateObj)
    } catch (error) {
      console.warn('Invalid date in cancel subscription:', date, error)
      return 'end of current billing period'
    }
  }

  const periodEndDate = getPeriodEndDate()

  // Check if subscription is set to cancel at period end
  const isCancelAtPeriodEnd = (() => {
    const subscriptionStatus = getSubscriptionStatus()
    if (subscriptionStatus.isTeam || subscriptionStatus.isEnterprise) {
      return useOrganizationStore.getState().subscriptionData?.cancelAtPeriodEnd === true
    }
    return false
  })()

  return (
    <>
      <div className='flex items-center justify-between'>
        <div>
          <span className='font-medium text-sm'>Manage Subscription</span>
          {isCancelAtPeriodEnd && (
            <p className='mt-1 text-muted-foreground text-xs'>
              You'll keep access until {formatDate(periodEndDate)}
            </p>
          )}
        </div>
        <Button
          variant='outline'
          onClick={() => setIsDialogOpen(true)}
          disabled={isLoading}
          className={cn(
            'h-8 rounded-[8px] font-medium text-xs transition-all duration-200',
            error
              ? 'border-red-500 text-red-500 dark:border-red-500 dark:text-red-500'
              : 'text-muted-foreground hover:border-red-500 hover:bg-red-500 hover:text-white dark:hover:border-red-500 dark:hover:bg-red-500'
          )}
        >
          {error ? 'Error' : 'Manage'}
        </Button>
      </div>

      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCancelAtPeriodEnd ? 'Manage' : 'Cancel'} {subscription.plan} subscription?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isCancelAtPeriodEnd
                ? 'Your subscription is set to cancel at the end of the billing period. You can reactivate it or manage other settings.'
                : `You'll be redirected to Stripe to manage your subscription. You'll keep access until ${formatDate(
                    periodEndDate
                  )}, then downgrade to free plan.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!isCancelAtPeriodEnd && (
            <div className='py-2'>
              <div className='rounded-[8px] bg-muted/50 p-3 text-sm'>
                <ul className='space-y-1 text-muted-foreground text-xs'>
                  <li>• Keep all features until {formatDate(periodEndDate)}</li>
                  <li>• No more charges</li>
                  <li>• Data preserved</li>
                  <li>• Can reactivate anytime</li>
                </ul>
              </div>
            </div>
          )}

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-[8px]'
              onClick={handleKeep}
              disabled={isLoading}
            >
              Keep Subscription
            </AlertDialogCancel>

            {(() => {
              const subscriptionStatus = getSubscriptionStatus()
              if (
                subscriptionStatus.isPaid &&
                (activeOrganization?.id
                  ? useOrganizationStore.getState().subscriptionData?.cancelAtPeriodEnd
                  : false)
              ) {
                return (
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className='w-full'>
                          <AlertDialogAction
                            disabled
                            className='h-9 w-full cursor-not-allowed rounded-[8px] bg-muted text-muted-foreground opacity-50'
                          >
                            Continue
                          </AlertDialogAction>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side='top'>
                        <p>Subscription will be cancelled at end of billing period</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )
              }
              return (
                <AlertDialogAction
                  onClick={handleCancel}
                  className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                  disabled={isLoading}
                >
                  {isLoading ? 'Redirecting...' : 'Continue'}
                </AlertDialogAction>
              )
            })()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
