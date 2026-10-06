import { closeIssueContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { closeIssue } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const POST = defineInternalJsonRoute({
  contract: closeIssueContract,
  auth: internalSessionAuth,
  operation: issueOperations.close,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, key: params.key, ...body }),
  useCase: closeIssue,
})
