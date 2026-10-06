import { addIssueResourceContract, removeIssueResourceContract } from '@/lib/api/contracts/issues'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { addIssueResource, removeIssueResource } from '@/lib/issues/application/issues'
import { issueOperations } from '@/lib/issues/application/operations'

export const POST = defineInternalJsonRoute({
  contract: addIssueResourceContract,
  auth: internalSessionAuth,
  operation: issueOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    key: params.key,
    resourceType: body.type,
    resourceId: body.resourceId,
  }),
  useCase: addIssueResource,
})

export const DELETE = defineInternalJsonRoute({
  contract: removeIssueResourceContract,
  auth: internalSessionAuth,
  operation: issueOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'issues' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    key: params.key,
    resourceType: body.type,
    resourceId: body.resourceId,
  }),
  useCase: removeIssueResource,
})
