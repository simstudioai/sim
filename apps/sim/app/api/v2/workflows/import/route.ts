import { v2ImportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { importWorkflow } from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2ImportWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.import,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.import,
  parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    folderPath: body.folderPath,
    name: body.name,
    description: body.description,
    workflow: body.workflow,
  }),
  useCase: importWorkflow,
  present: ({ workflow, folderPath, warnings }) => ({
    data: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      workspaceId: workflow.workspaceId,
      folderPath,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      blocks: workflow.blocks,
      warnings,
    },
  }),
})
