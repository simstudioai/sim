import { subscriptionTransferContract } from '@/lib/api/contracts/user'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { transferSubscriptionToOrganization } from '@/lib/billing/application/subscription-transfer'
import { ForbiddenOperationError } from '@/lib/core/application'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { captureServerEvent } from '@/lib/posthog/server'

export const POST = defineInternalJsonRoute({
  contract: subscriptionTransferContract,
  auth: internalSessionAuth,
  operation: transferSubscriptionToOrganization.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve subscription transfer behavior' }),
  errorPolicy: {
    ...extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) =>
      error instanceof OrganizationMembershipNotFoundError ||
      (error instanceof ForbiddenOperationError &&
        error.detailCode === 'ORGANIZATION_ADMIN_REQUIRED')
        ? internalErrorResponse(403, { error: 'Unauthorized - user is not admin of organization' })
        : null
    ),
    unhandled: () => internalErrorResponse(500, { error: 'Failed to transfer subscription' }),
  },
  mapInput: ({ params, body }) => ({
    subscriptionId: params.id,
    organizationId: body.organizationId,
  }),
  useCase: transferSubscriptionToOrganization,
  onSuccess: ({ principal, input, result }) => {
    if (!result.transferred) return
    captureServerEvent(principal.userId, 'subscription_transferred', {
      subscription_id: input.subscriptionId,
      from_entity: 'user',
      to_entity: 'organization',
    })
  },
  present: ({ message }) => ({ success: true as const, message }),
})
