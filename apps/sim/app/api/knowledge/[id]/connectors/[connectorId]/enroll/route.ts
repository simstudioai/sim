import { startKnowledgeConnectorMemberEnrollmentContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: startKnowledgeConnectorMemberEnrollmentContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.enrollConnectorMember,
  rateLimit: internalRateLimits.none({
    reason:
      'A member connecting their own account by hand; each call only re-issues their own invitation',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectAccount,
  mapInput: ({ params, query }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    oauthCompletionId: query.oauthCompletionId,
  }),
  useCase: startKnowledgeConnectorMemberEnrollment,
  present: ({ url }) => ({ success: true as const, data: { url } }),
})
