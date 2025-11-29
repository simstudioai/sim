'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import { getBaseUrl } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'

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
  const { data: orgsData } = useOrganizations()
  const { data: subData } = useSubscriptionData()
  const queryClient = useQueryClient()
  const activeOrganization = orgsData?.activeOrganization
  const currentSubscriptionStatus = getSubscriptionStatus(subData?.data)

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
      const subscriptionStatus = currentSubscriptionStatus
      const activeOrgId = activeOrganization?.id

      let referenceId = session.user.id
      let subscriptionId: string | undefined

      if (subscriptionStatus.isTeam && activeOrgId) {
        referenceId = activeOrgId
        // Get subscription ID for team/enterprise
        subscriptionId = subData?.data?.id
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
      const subscriptionStatus = currentSubscriptionStatus
      const activeOrgId = activeOrganization?.id

      if (isCancelAtPeriodEnd) {
        if (!betterAuthSubscription.restore) {
          throw new Error('Subscription restore not available')
        }

        let referenceId: string
        let subscriptionId: string | undefined

        if ((subscriptionStatus.isTeam || subscriptionStatus.isEnterprise) && activeOrgId) {
          referenceId = activeOrgId
          subscriptionId = subData?.data?.id
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

      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.user() })
      if (activeOrgId) {
        await queryClient.invalidateQueries({ queryKey: organizationKeys.detail(activeOrgId) })
        await queryClient.invalidateQueries({ queryKey: organizationKeys.billing(activeOrgId) })
        await queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
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
            'h-8 rounded-[8px] font-medium text-xs',
            error && 'border-red-500 text-red-500 dark:border-red-500 dark:text-red-500'
          )}
        >
          {error ? 'Error' : isCancelAtPeriodEnd ? 'Restore' : 'Manage'}
        </Button>
      </div>

      <Modal open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {isCancelAtPeriodEnd ? 'Restore' : 'Cancel'} {subscription.plan} subscription?
            </ModalTitle>
            <ModalDescription>
              {isCancelAtPeriodEnd
                ? 'Your subscription is set to cancel at the end of the billing period. Would you like to keep your subscription active?'
                : `You'll be redirected to Stripe to manage your subscription. You'll keep access until ${formatDate(
                    periodEndDate
                  )}, then downgrade to free plan.`}{' '}
              {!isCancelAtPeriodEnd && (
                <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                  This action cannot be undone.
                </span>
              )}
            </ModalDescription>
          </ModalHeader>

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

          <ModalFooter>
            <Button
              variant='outline'
              className='h-[32px] px-[12px]'
              onClick={isCancelAtPeriodEnd ? () => setIsDialogOpen(false) : handleKeep}
              disabled={isLoading}
            >
              {isCancelAtPeriodEnd ? 'Cancel' : 'Keep Subscription'}
            </Button>

            {(() => {
              const subscriptionStatus = currentSubscriptionStatus
              if (subscriptionStatus.isPaid && isCancelAtPeriodEnd) {
                return (
                  <Button
                    onClick={handleKeep}
                    className='h-[32px] bg-green-500 px-[12px] text-white hover:bg-green-600 dark:bg-green-500 dark:hover:bg-green-600'
                    disabled={isLoading}
                  >
                    {isLoading ? 'Restoring...' : 'Restore Subscription'}
                  </Button>
                )
              }
              return (
                <Button
                  onClick={handleCancel}
                  className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
                  disabled={isLoading}
                >
                  {isLoading ? 'Redirecting...' : 'Continue'}
                </Button>
              )
            })()}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
