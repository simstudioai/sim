import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { createFileReadReceipt, type FileReadReceipt } from '@/lib/workspace-files/read-receipt'
import { markFileSearchArtifactReadyInTx } from '@/lib/workspace-files/search/artifact-ready'

const logger = createLogger('FetchServableWorkspaceFileBuffer')

/**
 * Resolves the rendered bytes of an already-authorized workspace file while preserving the
 * Principal for any referenced-file reads performed by the document compiler.
 */
export async function fetchAuthorizedServableWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; signal?: AbortSignal; requestId?: string }
): Promise<{
  buffer: Buffer
  contentType: string
  receipt: FileReadReceipt
  dependsOnReferencedFiles: boolean
}> {
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
    }
  )
  const artifactKey = result.artifactKey
  if (artifactKey && result.contributingFiles?.every((file) => file.contentUpdatedAt) !== false) {
    await db.transaction((tx) =>
      markFileSearchArtifactReadyInTx(tx, {
        owner: { entityType: 'workspace', entityId: fileRecord.workspaceId },
        file: {
          fileId: fileRecord.id,
          key: fileRecord.key,
          contentUpdatedAt: fileRecord.contentUpdatedAt ?? fileRecord.updatedAt,
        },
        dependencies: (result.contributingFiles ?? []).map((file) => {
          if (!file.contentUpdatedAt || file.context !== 'workspace')
            throw new Error('Artifact input has no canonical workspace revision')
          return {
            fileId: file.fileId,
            key: file.key,
            sourceContentUpdatedAt: file.contentUpdatedAt,
          }
        }),
        artifactKey,
      })
    )
  }
  const receipt = createFileReadReceipt(
    { entityType: 'workspace', entityId: fileRecord.workspaceId },
    [
      { ...fileRecord, contentUpdatedAt: fileRecord.contentUpdatedAt ?? fileRecord.updatedAt },
      ...(result.contributingFiles ?? []).map((file) => {
        if (file.context !== 'workspace' || !file.contentUpdatedAt)
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
