import { v2ReadFileWorkflowInputContract } from '@/lib/api/contracts/v2/file-workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { readFileWorkflow } from '@/lib/workspace-files/application/file-workflows'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2ReadFileWorkflowInputContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readWorkflowResult,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  parseOptions: { maxBodyBytes: 20 * 1024 },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    workflowId: params.workflowId,
    assertedWorkspaceId: body.workspaceId,
    input: body.input,
  }),
  useCase: readFileWorkflow,
  present: (result) => ({ data: result }),
})
