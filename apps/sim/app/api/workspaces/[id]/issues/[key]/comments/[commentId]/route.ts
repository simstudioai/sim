import { deleteIssueCommentContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deleteIssueComment } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const DELETE = defineInternalJsonRoute({
  contract: deleteIssueCommentContract,
  auth: internalSessionAuth,
  operation: issueOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    key: params.key,
    commentId: params.commentId,
  }),
  useCase: deleteIssueComment,
})
