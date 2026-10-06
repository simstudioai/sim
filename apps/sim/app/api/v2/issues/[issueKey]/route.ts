import { v2GetIssueContract } from '@/lib/api/contracts/v2/issues'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { getIssueDetail } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'
import { toV2Issue } from '@/app/api/v2/issues/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/issues/[issueKey] — Get an issue by its key. */
export const GET = defineV2JsonRoute({
  contract: v2GetIssueContract,
  operation: issueOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({ notFoundMessage: 'Issue not found' }),
  mapInput: ({ params, query }) => ({ workspaceId: query.workspaceId, key: params.issueKey }),
  useCase: getIssueDetail,
  present: ({ issue }) => ({ data: toV2Issue(issue) }),
})
