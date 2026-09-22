import {
  v2ReadFileWorkflowContract,
  v2RunFileWorkflowContract,
} from '@/lib/api/contracts/v2/file-workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { readFileWorkflow, runFileWorkflow } from '@/lib/workspace-files/application/file-workflows'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2ReadFileWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readWorkflowResult,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    workflowId: params.workflowId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readFileWorkflow,
  present: (result) => ({ data: result }),
})
export const POST = defineV2JsonRoute({
  contract: v2RunFileWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.runWorkflow,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  parseOptions: { maxBodyBytes: 20 * 1024 },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    workflowId: params.workflowId,
    assertedWorkspaceId: body.workspaceId,
    input: body.input,
  }),
  useCase: runFileWorkflow,
  present: (result) => ({ data: result }),
})
