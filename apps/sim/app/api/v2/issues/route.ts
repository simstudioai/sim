import { v2CreateIssueContract } from '@/lib/api/contracts/v2/issues'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { createIssue } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'
import { toV2Issue } from '@/app/api/v2/issues/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/issues — File an issue. */
export const POST = defineV2JsonRoute({
  contract: v2CreateIssueContract,
  operation: issueOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createIssue,
  present: ({ issue }) => ({ data: toV2Issue(issue) }),
})
