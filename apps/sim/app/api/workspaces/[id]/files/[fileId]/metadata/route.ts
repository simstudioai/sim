import { updateFileWorkflowMetadataContract } from '@/lib/api/contracts/file-workflows'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { updateWorkspaceFileMetadata } from '@/lib/workspace-files/application/update-workspace-file-metadata'

export const PATCH = defineInternalJsonRoute({
  contract: updateFileWorkflowMetadataContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateMetadata,
  rateLimit: internalRateLimits.user({ bucketName: 'file-metadata' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 4096 },
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    workflowIds: body.workflowIds,
  }),
  useCase: updateWorkspaceFileMetadata,
})
