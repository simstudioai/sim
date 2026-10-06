import { getIssueContract, updateIssueContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getIssueDetail, updateIssue } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getIssueContract,
  auth: internalSessionAuth,
  operation: issueOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, key: params.key }),
  useCase: getIssueDetail,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateIssueContract,
  auth: internalSessionAuth,
  operation: issueOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, key: params.key, ...body }),
  useCase: updateIssue,
})
