import { updateOrganizationAccountIndexingContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  updateOrganizationAccountIndexing,
  updateOrganizationAccountIndexingOperation,
} from '@/lib/credential-groups/application/organization-account-indexing'

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationAccountIndexingContract,
  auth: internalSessionAuth,
  operation: updateOrganizationAccountIndexingOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-account-indexing' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: updateOrganizationAccountIndexing,
  present: ({ enabled, knowledgeBaseIds }) => ({ enabled, knowledgeBaseIds }),
})
