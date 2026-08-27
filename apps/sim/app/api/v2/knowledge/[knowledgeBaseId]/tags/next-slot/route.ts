import { v2GetNextKnowledgeTagSlotContract } from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readNextKnowledgeTagSlot } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/tags/next-slot — Slot availability for a field type.
 *
 * Lets a caller decide whether a create will succeed before attempting it, and
 * which slot it would take. `POST /api/v2/knowledge/{knowledgeBaseId}/tags` assigns the same
 * slot when `tagSlot` is omitted, so this is advisory rather than a claim.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetNextKnowledgeTagSlotContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readNextTagSlot,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    fieldType: query.fieldType,
  }),
  useCase: readNextKnowledgeTagSlot,
  present: (data) => ({ data }),
})
