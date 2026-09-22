import {
  readFileWorkflowContract,
  runFileWorkflowContract,
} from '@/lib/api/contracts/file-workflows'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readFileWorkflow, runFileWorkflow } from '@/lib/workspace-files/application/file-workflows'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const GET = defineInternalJsonRoute({
  contract: readFileWorkflowContract,
  auth: internalSessionAuth,
  operation: fileOperations.readWorkflowResult,
  rateLimit: internalRateLimits.user({ bucketName: 'file-workflow-read' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    workflowId: params.workflowId,
  }),
  useCase: readFileWorkflow,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
export const POST = defineInternalJsonRoute({
  contract: runFileWorkflowContract,
  auth: internalSessionAuth,
  operation: fileOperations.runWorkflow,
  rateLimit: internalRateLimits.user({ bucketName: 'file-workflow-run' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 1024 },
  mapInput: ({ params }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    workflowId: params.workflowId,
  }),
  useCase: runFileWorkflow,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
