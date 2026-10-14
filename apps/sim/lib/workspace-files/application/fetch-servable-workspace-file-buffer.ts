import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  downloadServableFileFromStorage,
  type ServableFile,
} from '@/lib/uploads/utils/file-utils.server'
import {
  isFileSearchArtifactCurrent,
  markFileSearchArtifactReadyInTx,
} from '@/lib/workspace-files/search/artifact-ready'

const logger = createLogger('FetchServableWorkspaceFileBuffer')

/** The bytes are already fetched, so a contended search requeue gives up rather than stall the read. */
const ARTIFACT_READY_LOCK_TIMEOUT_MS = 1_000

/**
 * Resolves the rendered bytes of an already-authorized workspace file while preserving the
 * Principal for any referenced-file reads performed by the document compiler. The result names
 * every other file the render embedded, whose content those bytes now carry.
 */
export async function fetchAuthorizedServableWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; signal?: AbortSignal; requestId?: string }
): Promise<ServableFile> {
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
  if (
    artifactKey &&
    result.contributingFiles?.every(
      (file) => file.contentUpdatedAt && ['workspace', 'test', 'changelog'].includes(file.context)
    ) !== false
  ) {
    try {
      const completion = {
        owner: { entityType: 'workspace' as const, entityId: fileRecord.workspaceId },
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
      }
      if (!(await isFileSearchArtifactCurrent(db, completion)))
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('lock_timeout', ${`${ARTIFACT_READY_LOCK_TIMEOUT_MS}ms`}, true)`
          )
          await markFileSearchArtifactReadyInTx(tx, completion)
        })
    } catch (error) {
      logger.warn('Could not requeue file search for a rendered artifact', {
        fileId: fileRecord.id,
        error: getErrorMessage(error),
      })
    }
  }
  return result
}
