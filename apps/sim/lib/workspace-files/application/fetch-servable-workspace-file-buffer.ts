import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadServableFileFromStorage, type ServableFile } from '@/lib/uploads/utils/file.server'
import { createFileReadReceipt, type FileReadReceipt } from '@/lib/workspace-files/read-receipt'
import { requeueFileSearchForRenderedArtifact } from '@/lib/workspace-files/search/artifact-ready'

const logger = createLogger('FetchServableWorkspaceFileBuffer')

/**
 * Resolves the rendered bytes of an already-authorized workspace file while preserving the
 * Principal for any referenced-file reads performed by the document compiler. The result names
 * every other file the render embedded, whose content those bytes now carry.
 */
export async function fetchAuthorizedServableWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; signal?: AbortSignal; requestId?: string }
): Promise<ServableFile & { receipt: FileReadReceipt; dependsOnReferencedFiles: boolean }> {
  const subjectUserId = resolvePrincipalSubjectUserId(filePrincipal)
  const result = await downloadServableFileFromStorage(
    {
      id: fileRecord.id,
      name: fileRecord.name,
      url: fileRecord.url ?? fileRecord.path,
      size: fileRecord.size,
      type: fileRecord.type,
      key: fileRecord.key,
      context: fileRecord.storageContext ?? 'workspace',
    },
    options.requestId ?? generateRequestId(),
    logger,
    {
      ...options,
      filePrincipal,
      ownerKey: subjectUserId ? `user:${subjectUserId}` : `workspace:${fileRecord.workspaceId}`,
    }
  )
  const artifactKey = result.artifactKey
  if (
    artifactKey &&
    result.contributingFiles?.every(
      (file) => file.contentUpdatedAt && ['workspace', 'test', 'changelog'].includes(file.context)
    ) !== false
  ) {
    try {
      await requeueFileSearchForRenderedArtifact({
        owner: { entityType: 'workspace', entityId: fileRecord.workspaceId },
        file: {
          fileId: fileRecord.id,
          key: fileRecord.key,
          contentUpdatedAt: fileRecord.contentUpdatedAt ?? fileRecord.updatedAt,
        },
        dependencies: (result.contributingFiles ?? []).map((file) => {
          if (!file.contentUpdatedAt)
            throw new Error('Artifact input has no canonical workspace revision')
          return {
            fileId: file.fileId,
            key: file.key,
            sourceContentUpdatedAt: file.contentUpdatedAt,
          }
        }),
        artifactKey,
      })
    } catch (error) {
      logger.warn('Could not requeue file search for a rendered artifact', {
        fileId: fileRecord.id,
        error: getErrorMessage(error),
      })
    }
  }
  const receipt = createFileReadReceipt(
    { entityType: 'workspace', entityId: fileRecord.workspaceId },
    [
      { ...fileRecord, contentUpdatedAt: fileRecord.contentUpdatedAt ?? fileRecord.updatedAt },
      ...(result.contributingFiles ?? []).map((file) => {
        if (!['workspace', 'test', 'changelog'].includes(file.context) || !file.contentUpdatedAt)
          throw new OrchestrationError('conflict', 'Document input has no canonical revision')
        return { id: file.fileId, key: file.key, contentUpdatedAt: file.contentUpdatedAt }
      }),
    ]
  )
  return {
    ...result,
    receipt,
    dependsOnReferencedFiles: result.dependsOnReferencedFiles ?? receipt.files.length > 1,
  }
}
