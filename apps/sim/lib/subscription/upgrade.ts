import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { client, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { organizationKeys } from '@/hooks/queries/organization'

const logger = createLogger('SubscriptionUpgrade')

type TargetPlan = 'pro' | 'team'

const CONSTANTS = {
  INITIAL_TEAM_SEATS: 1,
} as const

/**
 * Handles organization creation for team plans and proper referenceId management
 */
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
      try {
        const listResult = await client.subscription.list()
        const activePersonalSub = listResult.data?.find(
          (sub: any) => sub.status === 'active' && sub.referenceId === userId
        )
        currentSubscriptionId = activePersonalSub?.id
      } catch (_e) {
        currentSubscriptionId = undefined
      }

      let referenceId = userId

      // For team plans, create organization first and use its ID as referenceId
      if (targetPlan === 'team') {
        try {
          // Check if user already has an organization where they are owner/admin
          const orgsResponse = await fetch('/api/organizations')
          if (orgsResponse.ok) {
            const orgsData = await orgsResponse.json()
            const existingOrg = orgsData.organizations?.find(
              (org: any) => org.role === 'owner' || org.role === 'admin'
            )

            if (existingOrg) {
              logger.info('Using existing organization for team plan upgrade', {
                userId,
                organizationId: existingOrg.id,
              })
              referenceId = existingOrg.id
            }
          }

          // Only create new organization if no suitable one exists
          if (referenceId === userId) {
            logger.info('Creating organization for team plan upgrade', {
              userId,
            })

            const response = await fetch('/api/organizations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            })

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              if (response.status === 409) {
                throw new Error(
                  'You are already a member of an organization. Please leave it or ask an admin to upgrade.'
                )
              }
              throw new Error(
                errorData.message || `Failed to create organization: ${response.statusText}`
              )
            }
            const result = await response.json()

            logger.info('Organization API response', {
              result,
              success: result.success,
              organizationId: result.organizationId,
            })

            if (!result.success || !result.organizationId) {
              throw new Error('Failed to create organization for team plan')
            }

            referenceId = result.organizationId
          }

          // Set the organization as active so Better Auth recognizes it
          try {
            await client.organization.setActive({ organizationId: referenceId })

            logger.info('Set organization as active', {
              organizationId: referenceId,
              oldReferenceId: userId,
              newReferenceId: referenceId,
            })
          } catch (error) {
            logger.warn('Failed to set organization as active, but proceeding with upgrade', {
              organizationId: referenceId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            // Continue with upgrade even if setting active fails
          }
        } catch (error) {
          logger.error('Failed to prepare organization for team plan', error)
          throw error instanceof Error
            ? error
            : new Error('Failed to prepare team workspace. Please try again or contact support.')
        }
      }

      const currentUrl = `${window.location.origin}${window.location.pathname}`

      try {
        const upgradeParams = {
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetPlan === 'team' && { seats: CONSTANTS.INITIAL_TEAM_SEATS }),
        } as const

        // Add subscriptionId for existing subscriptions to ensure proper plan switching
        const finalParams = currentSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentSubscriptionId }
          : upgradeParams

        logger.info(
          currentSubscriptionId ? 'Upgrading existing subscription' : 'Creating new subscription',
          {
            targetPlan,
            currentSubscriptionId,
            referenceId,
          }
        )

        await betterAuthSubscription.upgrade(finalParams)

        // If upgrading to team plan, ensure the subscription is transferred to the organization
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
              // We don't throw here because the upgrade itself succeeded
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

        // For team plans, refresh organization data to ensure UI updates
        if (targetPlan === 'team') {
          try {
            await queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
            logger.info('Refreshed organization data after team upgrade')
          } catch (error) {
            logger.warn('Failed to refresh organization data after upgrade', error)
            // Don't fail the entire upgrade if data refresh fails
          }
        }

        logger.info('Subscription upgrade completed successfully', {
          targetPlan,
          referenceId,
        })
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
