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
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
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
    cancelAtPeriodEnd?: boolean
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

      const returnUrl = getBaseUrl() + window.location.pathname.split('/w/')[0]

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

      if (isCancelAtPeriodEnd) {
        if (!betterAuthSubscription.restore) {
          throw new Error('Subscription restore not available')
        }

        let referenceId: string
        let subscriptionId: string | undefined

        if ((subscriptionStatus.isTeam || subscriptionStatus.isEnterprise) && activeOrgId) {
          const orgSubscription = useOrganizationStore.getState().subscriptionData
          referenceId = activeOrgId
          subscriptionId = orgSubscription?.id
        } else {
          // For personal subscriptions, use user ID and let better-auth find the subscription
          referenceId = session.user.id
          subscriptionId = undefined
        }

        logger.info('Restoring subscription', { referenceId, subscriptionId })

        // Build restore params - only include subscriptionId if we have one (team/enterprise)
        const restoreParams: any = { referenceId }
        if (subscriptionId) {
          restoreParams.subscriptionId = subscriptionId
        }

        const result = await betterAuthSubscription.restore(restoreParams)

        logger.info('Subscription restored successfully', result)
      }

      await refresh()
      if (activeOrgId) {
        await loadOrganizationSubscription(activeOrgId)
        await refreshOrganization().catch(() => {})
      }

      setIsDialogOpen(false)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to restore subscription'
      setError(errorMessage)
      logger.error('Failed to restore subscription', { error })
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
  const isCancelAtPeriodEnd = subscriptionData?.cancelAtPeriodEnd === true

  return (
    <>
      <div className='flex items-center justify-between'>
        <div>
          <span className='font-medium text-sm'>
            {isCancelAtPeriodEnd ? 'Restore Subscription' : 'Manage Subscription'}
          </span>
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
              : isCancelAtPeriodEnd
                ? 'text-muted-foreground hover:border-green-500 hover:bg-green-500 hover:text-white dark:hover:border-green-500 dark:hover:bg-green-500'
                : 'text-muted-foreground hover:border-red-500 hover:bg-red-500 hover:text-white dark:hover:border-red-500 dark:hover:bg-red-500'
          )}
        >
          {error ? 'Error' : isCancelAtPeriodEnd ? 'Restore' : 'Manage'}
        </Button>
      </div>

      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCancelAtPeriodEnd ? 'Restore' : 'Cancel'} {subscription.plan} subscription?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isCancelAtPeriodEnd
                ? 'Your subscription is set to cancel at the end of the billing period. Would you like to keep your subscription active?'
                : `You'll be redirected to Stripe to manage your subscription. You'll keep access until ${formatDate(
                    periodEndDate
                  )}, then downgrade to free plan.`}{' '}
              {!isCancelAtPeriodEnd && (
                <span className='text-red-500 dark:text-red-500'>
                  This action cannot be undone.
                </span>
              )}
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
              onClick={isCancelAtPeriodEnd ? () => setIsDialogOpen(false) : handleKeep}
              disabled={isLoading}
            >
              {isCancelAtPeriodEnd ? 'Cancel' : 'Keep Subscription'}
            </AlertDialogCancel>

            {(() => {
              const subscriptionStatus = getSubscriptionStatus()
              if (subscriptionStatus.isPaid && isCancelAtPeriodEnd) {
                return (
                  <AlertDialogAction
                    onClick={handleKeep}
                    className='h-9 w-full rounded-[8px] bg-green-500 text-white transition-all duration-200 hover:bg-green-600 dark:bg-green-500 dark:hover:bg-green-600'
                    disabled={isLoading}
                  >
                    {isLoading ? 'Restoring...' : 'Restore Subscription'}
                  </AlertDialogAction>
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
