import { createIssueContract, listIssuesContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createIssue, listIssues } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listIssuesContract,
  auth: internalSessionAuth,
  operation: issueOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listIssues,
})

export const POST = defineInternalJsonRoute({
  contract: createIssueContract,
  auth: internalSessionAuth,
  operation: issueOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: createIssue,
})
