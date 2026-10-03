import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  assertUserFileContentAccess,
  ExecutionFileAccessError,
  type ExecutionMaterializationContext,
} from '@/lib/execution/payloads/materialization.server'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

export interface StoredFileProvenanceSource {
  identity: WorkspaceFileSecretProvenanceIdentity
  ownerUserId: string
}

/**
 * Binds an authorized stored-file read to its canonical content revision. Execution callers pass
 * the same trusted run capability used to read the bytes; a file object's id is never an identity.
 * Files predating metadata registration retain the caller's existing absence policy.
 */
export async function resolveStoredFileProvenanceSource(
  file: Pick<UserFile, 'key' | 'context'>,
  context: ExecutionMaterializationContext & { principal: Principal; workspaceId: string }
): Promise<StoredFileProvenanceSource | undefined> {
  if (!file.key) return undefined
  try {
    await assertUserFileContentAccess(file, context)
  } catch (error) {
    if (error instanceof ExecutionFileAccessError) {
      throw new OrchestrationError('not_found', 'File not found')
    }
    throw error
  }
  const storageContext = inferContextFromKey(file.key)
  if (storageContext !== 'workspace' && storageContext !== 'execution') return undefined

  const metadata = await getFileMetadataByKey(file.key, undefined, { includeDeleted: true })
  if (!metadata) return undefined
  if (
    (metadata.context !== 'workspace' &&
      metadata.context !== 'mothership' &&
      metadata.context !== 'execution') ||
    metadata.workspaceId !== context.workspaceId ||
    (storageContext === 'execution'
      ? metadata.context !== 'execution'
      : metadata.context !== 'workspace' && metadata.context !== 'mothership')
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return {
    identity: {
      fileId: metadata.id,
      key: metadata.key,
      context: metadata.context,
      contentUpdatedAt: metadata.contentUpdatedAt,
    },
    ownerUserId: metadata.userId,
  }
}
