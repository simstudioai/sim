import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { client, useSession, useSubscription } from '@/lib/auth/auth-client'
import { organizationKeys } from '@/hooks/queries/organization'

const logger = createLogger('SubscriptionUpgrade')

type TargetPlan = 'pro' | 'team'

const CONSTANTS = {
  INITIAL_TEAM_SEATS: 1,
} as const

export function useSubscriptionUpgrade() {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const queryClient = useQueryClient()

  const handleUpgrade = useCallback(
    async (targetPlan: TargetPlan) => {
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
          (sub: any) => sub.status === 'active' && sub.referenceId === userId
        )
        currentSubscriptionId = activePersonalSub?.id
      } catch (_e) {
        currentSubscriptionId = undefined
      }

      let referenceId = userId

      if (targetPlan === 'team') {
        try {
          const orgsResponse = await fetch('/api/organizations')
          if (!orgsResponse.ok) {
            throw new Error('Failed to check organization status')
          }

          const orgsData = await orgsResponse.json()
          const existingOrg = orgsData.organizations?.find(
            (org: any) => org.role === 'owner' || org.role === 'admin'
          )

          if (existingOrg) {
            // Check if this org already has an active team subscription
            const existingTeamSub = allSubscriptions.find(
              (sub: any) =>
                sub.status === 'active' &&
                sub.referenceId === existingOrg.id &&
                (sub.plan === 'team' || sub.plan === 'enterprise')
            )

            if (existingTeamSub) {
              logger.warn('Organization already has an active team subscription', {
                userId,
                organizationId: existingOrg.id,
                existingSubscriptionId: existingTeamSub.id,
              })
              throw new Error(
                'This organization already has an active team subscription. Please manage it from the billing settings.'
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
          plan: targetPlan,
          referenceId,
          successUrl,
          cancelUrl: currentUrl,
          ...(targetPlan === 'team' && { seats: CONSTANTS.INITIAL_TEAM_SEATS }),
        } as const

        const finalParams = currentSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentSubscriptionId }
          : upgradeParams

        logger.info(
          currentSubscriptionId ? 'Upgrading existing subscription' : 'Creating new subscription',
          { targetPlan, currentSubscriptionId, referenceId }
        )

        await betterAuthSubscription.upgrade(finalParams)

        if (targetPlan === 'team' && currentSubscriptionId && referenceId !== userId) {
          try {
            logger.info('Transferring subscription to organization after upgrade', {
              subscriptionId: currentSubscriptionId,
              organizationId: referenceId,
            })

            const transferResponse = await fetch(
              `/api/users/me/subscription/${currentSubscriptionId}/transfer`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId: referenceId }),
              }
            )

            if (!transferResponse.ok) {
              const text = await transferResponse.text()
              logger.error('Failed to transfer subscription to organization', {
                subscriptionId: currentSubscriptionId,
                organizationId: referenceId,
                error: text,
              })
            } else {
              logger.info('Successfully transferred subscription to organization', {
                subscriptionId: currentSubscriptionId,
                organizationId: referenceId,
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
