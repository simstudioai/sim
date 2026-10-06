import { startIssueContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { startIssue } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const POST = defineInternalJsonRoute({
  contract: startIssueContract,
  auth: internalSessionAuth,
  operation: issueOperations.start,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    key: params.key,
    chatId: body.chatId,
  }),
  useCase: startIssue,
})
