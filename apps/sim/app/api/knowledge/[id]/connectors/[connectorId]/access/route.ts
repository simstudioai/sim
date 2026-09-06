import { updateKnowledgeConnectorAccessContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  resolveInternalKnowledgeBillingAttribution,
  toInternalKnowledgeConnector,
} from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { updateKnowledgeConnectorAccess } from '@/lib/knowledge/application/connector-access'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const PATCH = defineInternalJsonRoute({
  contract: updateKnowledgeConnectorAccessContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.updateConnectorAccess,
  rateLimit: internalRateLimits.none({
    reason: 'A settings action an admin performs by hand; the switch itself is bounded',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, body }, { principal, request }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    accessMode: body.accessMode,
    credentialId: body.credentialId,
    resolveBillingAttribution: (workspaceId: string) =>
      resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
    source: 'ui' as const,
  }),
  useCase: updateKnowledgeConnectorAccess,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnector(connector),
  }),
})
