import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { listCreatorOrganizationsContract } from '@/lib/api/contracts/creator-profile'
import { subscriptionTransferContract } from '@/lib/api/contracts/user'
import { client, useSession, useSubscription } from '@/lib/auth/auth-client'
import { buildPlanName, getDisplayPlanName, isPaid } from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { organizationKeys } from '@/hooks/queries/organization'

const logger = createLogger('SubscriptionUpgrade')

type TargetPlan = 'pro' | 'team'

const CONSTANTS = {
  INITIAL_TEAM_SEATS: 1,
  DEFAULT_CREDIT_TIER: 6000,
} as const

interface UpgradeOptions {
  creditTier?: number
  annual?: boolean
  seats?: number
}

export function useSubscriptionUpgrade() {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const queryClient = useQueryClient()

  const handleUpgrade = useCallback(
    async (targetPlan: TargetPlan, options?: UpgradeOptions) => {
      const creditTier = options?.creditTier ?? CONSTANTS.DEFAULT_CREDIT_TIER
      const annual = options?.annual ?? false
      const planName = buildPlanName(targetPlan, creditTier)
      const userId = session?.user?.id
      if (!userId) {
        throw new Error('User not authenticated')
      }

      let currentSubscriptionId: string | undefined
      let allSubscriptions: any[] = []
      try {
        const listResult = await client.subscription.list()
        allSubscriptions = listResult.data || []
        const activePersonalSub = allSubscriptions.find(
          (sub: any) => hasPaidSubscriptionStatus(sub.status) && sub.referenceId === userId
        )
        currentSubscriptionId = activePersonalSub?.id
      } catch (_e) {
        currentSubscriptionId = undefined
      }

      let referenceId = userId

      if (targetPlan === 'team') {
        try {
          let orgsData
          try {
            orgsData = await requestJson(listCreatorOrganizationsContract, {})
          } catch (err) {
            if (err instanceof ApiClientError) {
              throw new Error('Failed to check organization status')
            }
            throw err
          }
          const existingOrg = orgsData.organizations?.find(
            (org) => org.role === 'owner' || org.role === 'admin'
          )

          if (existingOrg) {
            const existingOrgSub = allSubscriptions.find(
              (sub: any) =>
                hasPaidSubscriptionStatus(sub.status) &&
                sub.referenceId === existingOrg.id &&
                isPaid(sub.plan)
            )

            if (existingOrgSub) {
              logger.warn('Organization already has an active subscription', {
                userId,
                organizationId: existingOrg.id,
                existingSubscriptionId: existingOrgSub.id,
                plan: existingOrgSub.plan,
              })
              const existingPlanName = getDisplayPlanName(existingOrgSub.plan)
              throw new Error(
                `This organization is already on the ${existingPlanName} plan. Manage it from the billing settings.`
              )
            }

            logger.info('Using existing organization for team plan upgrade', {
              userId,
              organizationId: existingOrg.id,
            })
            referenceId = existingOrg.id

            try {
              await client.organization.setActive({ organizationId: referenceId })
              logger.info('Set organization as active', { organizationId: referenceId })
            } catch (error) {
              logger.warn('Failed to set organization as active, proceeding with upgrade', {
                organizationId: referenceId,
                error: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          } else if (orgsData.isMemberOfAnyOrg) {
            throw new Error(
              'You are already a member of an organization. Please leave it or ask an admin to upgrade.'
            )
          } else {
            logger.info('Will create organization after payment succeeds', { userId })
          }
        } catch (error) {
          logger.error('Failed to prepare for team plan upgrade', error)
          throw error instanceof Error
            ? error
            : new Error('Failed to prepare team workspace. Please try again or contact support.')
        }
      }

      const currentUrl = `${window.location.origin}${window.location.pathname}`
      const successUrlObj = new URL(window.location.href)
      successUrlObj.searchParams.set('upgraded', 'true')
      const successUrl = successUrlObj.toString()

      try {
        const upgradeParams = {
          plan: planName,
          referenceId,
          successUrl,
          cancelUrl: currentUrl,
          ...(targetPlan === 'team' && { seats: options?.seats ?? CONSTANTS.INITIAL_TEAM_SEATS }),
          ...(annual && { annual: true }),
        } as const

        const finalParams = currentSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentSubscriptionId }
          : upgradeParams

        logger.info(
          currentSubscriptionId ? 'Upgrading existing subscription' : 'Creating new subscription',
          { targetPlan, planName, annual, currentSubscriptionId, referenceId }
        )

        await betterAuthSubscription.upgrade(finalParams)

        if (targetPlan === 'team' && currentSubscriptionId && referenceId !== userId) {
          try {
            logger.info('Transferring subscription to organization after upgrade', {
              subscriptionId: currentSubscriptionId,
              organizationId: referenceId,
            })

            try {
              await requestJson(subscriptionTransferContract, {
                params: { id: currentSubscriptionId },
                body: { organizationId: referenceId },
              })
              logger.info('Successfully transferred subscription to organization', {
                subscriptionId: currentSubscriptionId,
                organizationId: referenceId,
              })
            } catch (transferError) {
              logger.error('Failed to transfer subscription to organization', {
                subscriptionId: currentSubscriptionId,
                organizationId: referenceId,
                error:
                  transferError instanceof ApiClientError
                    ? (transferError.rawBody ?? transferError.message)
                    : transferError instanceof Error
                      ? transferError.message
                      : 'Unknown error',
              })
            }
          } catch (error) {
            logger.error('Error transferring subscription after upgrade', error)
          }
        }

        if (targetPlan === 'team') {
          try {
            await queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
            logger.info('Refreshed organization data after team upgrade')
          } catch (error) {
            logger.warn('Failed to refresh organization data after upgrade', error)
          }
        }

        logger.info('Subscription upgrade completed successfully', { targetPlan, referenceId })
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)

        if (error instanceof Error) {
          logger.error('Detailed error:', {
            message: error.message,
            stack: error.stack,
            cause: error.cause,
          })
        }

        throw new Error(
          `Failed to upgrade subscription: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    },
    [session?.user?.id, betterAuthSubscription, queryClient]
  )

  return { handleUpgrade }
}
