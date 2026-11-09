import { searchOrganizationMentionsContract } from '@/lib/api/contracts/organization-mentions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { mentionOperations } from '@/lib/mentions/application/operations'
import { searchMentions } from '@/lib/mentions/application/search-mentions'

/** Type-ahead pacing: the composer debounces, and a browse expands one workspace at a time. */
const MENTION_TYPE_AHEAD_LIMIT = { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 }

export const GET = defineInternalJsonRoute({
  contract: searchOrganizationMentionsContract,
  auth: internalSessionAuth,
  operation: mentionOperations.search,
  rateLimit: internalRateLimits.user({
    bucketName: 'organization-mentions',
    config: MENTION_TYPE_AHEAD_LIMIT,
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    query: query.query,
    workspaceId: query.workspaceId,
    family: query.family,
    folderId: query.folderId,
    limit: query.limit,
  }),
  useCase: searchMentions,
})
