'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { useSession, useSubscription } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client/utils'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { organizationKeys, useOrganizations } from '@/hooks/queries/organization'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('CancelSubscription')

interface SubscriptionCancelParams {
  returnUrl: string
  referenceId: string
  subscriptionId?: string
}

interface SubscriptionRestoreParams {
  referenceId: string
  subscriptionId?: string
}

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

/**
 * Manages subscription cancellation and restoration.
 */
export function CancelSubscription({ subscription, subscriptionData }: CancelSubscriptionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations()

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const { data: orgsData } = useOrganizations()
  const { data: subData } = useSubscriptionData()
  const queryClient = useQueryClient()
  const activeOrganization = orgsData?.activeOrganization
  const currentSubscriptionStatus = getSubscriptionStatus(subData?.data)

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

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

      const cancelParams: SubscriptionCancelParams = {
        returnUrl,
        referenceId,
        ...(subscriptionId && { subscriptionId }),
      }

      const result = await betterAuthSubscription.cancel(cancelParams)

      if (result && 'error' in result && result.error) {
        setError(result.error.message || 'Failed to cancel subscription')
        logger.error('Failed to cancel subscription via Better Auth', { error: result.error })
      } else {
        logger.info('Redirecting to Stripe Billing Portal for cancellation')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to cancel subscription'
      setError(errorMessage)
      logger.error('Failed to cancel subscription', { error: err })
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
          referenceId = session.user.id
          subscriptionId = undefined
        }

        logger.info('Restoring subscription', { referenceId, subscriptionId })

        const restoreParams: SubscriptionRestoreParams = {
          referenceId,
          ...(subscriptionId && { subscriptionId }),
        }

        const result = await betterAuthSubscription.restore(restoreParams)

        logger.info('Subscription restored successfully', result)
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all }),
        ...(activeOrgId
          ? [
              queryClient.invalidateQueries({ queryKey: organizationKeys.detail(activeOrgId) }),
              queryClient.invalidateQueries({ queryKey: organizationKeys.billing(activeOrgId) }),
              queryClient.invalidateQueries({ queryKey: organizationKeys.lists() }),
            ]
          : []),
      ])

      setIsDialogOpen(false)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to restore subscription'
      setError(errorMessage)
      logger.error('Failed to restore subscription', { error: err })
    } finally {
      setIsLoading(false)
    }
  }

  const getPeriodEndDate = () => {
    return subscriptionData?.periodEnd || null
  }

  const formatDate = (date: Date | null) => {
    if (!date) return t('settings.cancel_subscription.end_of_billing_period')

    try {
      const dateObj = date instanceof Date ? date : new Date(date)

      if (Number.isNaN(dateObj.getTime())) {
        return t('settings.cancel_subscription.end_of_billing_period')
      }

      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(dateObj)
    } catch (err) {
      logger.warn('Invalid date in cancel subscription', { date, error: err })
      return t('settings.cancel_subscription.end_of_billing_period')
    }
  }

  const periodEndDate = getPeriodEndDate()
  const isCancelAtPeriodEnd = subscriptionData?.cancelAtPeriodEnd === true

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-[2px]'>
          <Label>
            {isCancelAtPeriodEnd
              ? t('settings.cancel_subscription.labels.restore_subscription')
              : t('settings.cancel_subscription.labels.manage_subscription')}
          </Label>
          {isCancelAtPeriodEnd && (
            <span className='text-[12px] text-[var(--text-muted)]'>
              {t('settings.cancel_subscription.keep_access_until', {
                date: formatDate(periodEndDate),
              })}
            </span>
          )}
        </div>
        <Button
          variant='active'
          onClick={() => setIsDialogOpen(true)}
          disabled={isLoading}
          className={cn(
            'h-[32px] rounded-[6px] text-[12px]',
            error && 'border-[var(--text-error)] text-[var(--text-error)]'
          )}
        >
          {error
            ? t('settings.cancel_subscription.buttons.error')
            : isCancelAtPeriodEnd
              ? t('settings.cancel_subscription.buttons.restore')
              : t('settings.cancel_subscription.buttons.manage')}
        </Button>
      </div>

      <Modal open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>
            {isCancelAtPeriodEnd
              ? t('settings.cancel_subscription.modal.restore_title', { plan: subscription.plan })
              : t('settings.cancel_subscription.modal.cancel_title', { plan: subscription.plan })}
          </ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {isCancelAtPeriodEnd
                ? t('settings.cancel_subscription.modal.restore_description')
                : t('settings.cancel_subscription.modal.cancel_description', {
                    date: formatDate(periodEndDate),
                  })}
            </p>

            {!isCancelAtPeriodEnd && (
              <div className='mt-[12px]'>
                <div className='rounded-[6px] bg-[var(--surface-4)] p-[12px]'>
                  <ul className='space-y-[4px] text-[12px] text-[var(--text-secondary)]'>
                    <li>
                      {t('settings.cancel_subscription.modal.keep_features_until', {
                        date: formatDate(periodEndDate),
                      })}
                    </li>
                    <li>{t('settings.cancel_subscription.modal.no_more_charges')}</li>
                    <li>{t('settings.cancel_subscription.modal.data_preserved')}</li>
                    <li>{t('settings.cancel_subscription.modal.can_reactivate')}</li>
                  </ul>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={isCancelAtPeriodEnd ? () => setIsDialogOpen(false) : handleKeep}
              disabled={isLoading}
            >
              {isCancelAtPeriodEnd
                ? t('settings.cancel_subscription.buttons.cancel')
                : t('settings.cancel_subscription.buttons.keep_subscription')}
            </Button>

            {currentSubscriptionStatus.isPaid && isCancelAtPeriodEnd ? (
              <Button variant='tertiary' onClick={handleKeep} disabled={isLoading}>
                {isLoading
                  ? t('settings.cancel_subscription.buttons.restoring')
                  : t('settings.cancel_subscription.buttons.restore_subscription')}
              </Button>
            ) : (
              <Button variant='destructive' onClick={handleCancel} disabled={isLoading}>
                {isLoading
                  ? t('settings.cancel_subscription.buttons.redirecting')
                  : t('settings.cancel_subscription.buttons.continue')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
