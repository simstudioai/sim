import { readFileWorkflowInputContract } from '@/lib/api/contracts/file-workflows'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readFileWorkflow } from '@/lib/workspace-files/application/file-workflows'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: readFileWorkflowInputContract,
  auth: internalSessionAuth,
  operation: fileOperations.readWorkflowResult,
  rateLimit: internalRateLimits.user({ bucketName: 'file-workflow-read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 20 * 1024 },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    workflowId: params.workflowId,
    input: body.input,
  }),
  useCase: readFileWorkflow,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
