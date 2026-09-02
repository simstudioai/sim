import { startKnowledgeConnectorMemberEnrollmentContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: startKnowledgeConnectorMemberEnrollmentContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.enrollConnectorMember,
  rateLimit: internalRateLimits.none({
    reason:
      'A member connecting their own account by hand; each call only re-issues their own invitation',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
  }),
  useCase: startKnowledgeConnectorMemberEnrollment,
  present: ({ url }) => ({ success: true as const, data: { url } }),
})
