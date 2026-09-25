import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import type { PrincipalForOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { tryInferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

interface DownloadToolFileInput {
  workspaceId: string
  fileId: string
}

/** Downloads a direct tool call's stored output using canonical ownership, never descriptor claims. */
export const downloadToolFile = defineAuthorizedWorkspaceUseCase({
  operation: toolExecutionOperations.downloadFile,
  authorizationOptions: {},
  async resolveContext({
    principal,
    input,
  }: {
    principal: PrincipalForOperation<typeof toolExecutionOperations.downloadFile>
    input: DownloadToolFileInput
  }) {
    const workspace = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'File not found')
    if (tryInferContextFromKey(input.fileId) !== 'copilot') {
      throw new OrchestrationError('not_found', 'File not found')
    }
    const file = await getFileMetadataByKey(input.fileId, 'copilot')
    if (
      !file ||
      file.deletedAt !== null ||
      file.context !== 'copilot' ||
      file.userId !== requirePrincipalSubjectUserId(principal) ||
      file.workspaceId !== null ||
      file.organizationId !== null
    ) {
      throw new OrchestrationError('not_found', 'File not found')
    }
    return { ...workspace, file }
  },
  async execute({ context }) {
    const { file } = context
    let stream: Awaited<ReturnType<typeof downloadFileStream>>
    try {
      stream = await downloadFileStream({ key: file.key, context: 'copilot' })
    } catch (error) {
      if (isObjectNotFoundError(error)) throw new OrchestrationError('not_found', 'File not found')
      throw error
    }
    return {
      file,
      stream: nodeReadableToWebStream(stream),
      contentType: file.contentType,
      contentLength: getWorkspaceFileSize(file),
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.originalName,
    description: `Downloaded tool file "${result.file.originalName}"`,
    metadata: { bytes: result.contentLength },
  }),
})
