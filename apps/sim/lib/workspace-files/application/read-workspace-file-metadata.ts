import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getShareForResource } from '@/lib/public-shares/share-manager'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileMetadataInput {
  fileId: string
  assertedWorkspaceId?: string
  /**
   * Opt into the archived lifecycle set. It relaxes only the `deleted_at` predicate on the
   * canonical row lookup — the workspace the file resolves to, the asserted-workspace check,
   * and the `files.read_metadata` authorization that follows are identical either way, so it
   * never widens who may read a file.
   */
  includeDeleted?: boolean
}

export interface ReadWorkspaceFileMetadataResult {
  file: WorkspaceFileRecord
  share: ShareRecord | null
}

async function executeReadWorkspaceFileMetadata({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readMetadata,
  ReadWorkspaceFileMetadataInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileMetadataResult> {
  const [file, share] = await Promise.all([
    getWorkspaceFile(context.workspaceId, context.fileId, {
      includeDeleted: input.includeDeleted,
      throwOnError: true,
    }),
    getShareForResource('file', context.fileId),
  ])
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file, share }
}

export const readWorkspaceFileMetadata = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileMetadata,
})
