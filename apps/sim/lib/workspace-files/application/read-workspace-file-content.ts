import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { isCopilotPrincipal } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  requireAdmittedWorkspaceFile,
  workspaceFileProvenanceIdentity,
} from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Optional post-authorization storage ceiling for bounded binary reads. */
  maxBytes?: number
  /** Opaque model inputs bypass text projection and must be admitted before loading bytes. */
  contentView?: 'complete' | 'opaque'
  includeDeleted?: boolean
  /** Loads the exact provenance bound to the authorized file version when requested. */
  includeSecretProvenance?: boolean
}

export interface ReadWorkspaceFileContentResult {
  file: WorkspaceFileRecord
  content: Buffer
  secretProvenance?: WorkspaceFileSecretProvenance
}

async function executeReadWorkspaceFileContent({
  input,
  context,
  principal,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileContentInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileContentResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    includeDeleted: input.includeDeleted,
    throwOnError: true,
    includeChatUploads: true,
    includeOwnedFiles: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const secretProvenance =
    input.includeSecretProvenance || isCopilotPrincipal(principal)
      ? await getBoundWorkspaceFileSecretProvenance(
          context.workspaceId,
          workspaceFileProvenanceIdentity(file)
        )
      : undefined
  await requireAdmittedWorkspaceFile(
    principal,
    context.workspaceId,
    file,
    input.contentView ?? 'complete',
    secretProvenance
  )
  let content: Buffer
  try {
    content = await fetchWorkspaceFileBuffer(file, {
      maxBytes: input.maxBytes ?? MAX_BUFFERED_TRANSFER_BYTES,
    })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw error
    if (
      isCopilotPrincipal(principal) &&
      (secretProvenance?.status === 'unknown' ||
        (secretProvenance?.status === 'exact' && secretProvenance.entries.length > 0))
    ) {
      throw new OrchestrationError('internal', 'File content could not be read')
    }
    throw error
  }
  return {
    file,
    content,
    ...(input.includeSecretProvenance && secretProvenance ? { secretProvenance } : {}),
  }
}

/**
 * A content read by id admits chat uploads: an id is an explicit reference, and the
 * `uploads/<name>` resolution that hands one to run_code or the image tools reads it back
 * through here. Listings never surface chat uploads and writes never resolve them.
 */
export const readWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ principal, input }) =>
    resolveActiveWorkspaceFileContext({
      ...input,
      includeChatUploads: true,
      ownedFilePrincipal: principal,
    }),
  execute: executeReadWorkspaceFileContent,
})
