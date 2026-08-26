import type { V2WorkflowVersionDetail } from '@/lib/api/contracts/v2/workflows'
import {
  v2GetWorkflowVersionContract,
  v2UpdateWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { updateWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowVersionContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId, version: params.version }),
  useCase: readWorkflowVersion,
  present: ({ version }) => ({
    data: {
      id: version.id,
      version: version.version,
      name: version.name,
      description: version.description,
      isActive: version.isActive,
      createdAt: version.createdAt.toISOString(),
      state: version.state as V2WorkflowVersionDetail['state'],
    },
  }),
})

/**
 * PATCH — relabel a deployment version.
 *
 * Metadata only. The pinned graph is immutable, so this can never change what
 * the version executes, and it never touches which version is live: promoting
 * one is `POST .../activate`. The internal editor's PATCH dispatches between
 * the two on the presence of `isActive` in the body; v2 deliberately does not,
 * because a body-shape switch between "rename" and "change what production
 * serves" is one typo away from the wrong outcome.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowVersionContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.updateVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({
    workflowId: params.workflowId,
    version: params.version,
    name: body.name,
    description: body.description,
  }),
  useCase: updateWorkflowVersion,
  present: (result) => ({
    data: {
      version: result.version,
      name: result.name,
      description: result.description,
    },
  }),
})
