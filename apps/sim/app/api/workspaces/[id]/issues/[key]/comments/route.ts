import { addIssueCommentContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { addIssueComment } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const POST = defineInternalJsonRoute({
  contract: addIssueCommentContract,
  auth: internalSessionAuth,
  operation: issueOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, key: params.key, body: body.body }),
  useCase: addIssueComment,
})
