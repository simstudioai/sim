import type { Principal } from '@sim/auth/principal'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getShareForResource } from '@/lib/public-shares/share-manager'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  getWorkspaceFileWithCurrentVersion,
  type VersionedWorkspaceFileRecord,
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

export interface ReadWorkspaceFileMetadataWithVersionResult
  extends ReadWorkspaceFileMetadataResult {
  file: VersionedWorkspaceFileRecord
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
      includeOwnedFiles: true,
    }),
    getShareForResource('file', context.fileId),
  ])
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file, share }
}

export const readWorkspaceFileMetadata = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({ principal, input }) =>
    resolveActiveWorkspaceFileContext({ ...input, ownedFilePrincipal: principal }),
  execute: executeReadWorkspaceFileMetadata,
})

/**
 * The same read plus the current version number, for the public metadata surface. Kept separate so
 * the many internal callers of {@link readWorkspaceFileMetadata} pay nothing for it.
 */
export const readWorkspaceFileMetadataWithVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkspaceFileMetadataInput
  }) => resolveActiveWorkspaceFileContext({ ...input, ownedFilePrincipal: principal }),
  async execute({ input, context }): Promise<ReadWorkspaceFileMetadataWithVersionResult> {
    const [file, share] = await Promise.all([
      getWorkspaceFileWithCurrentVersion(context.workspaceId, context.fileId, {
        includeDeleted: input.includeDeleted,
        includeOwnedFiles: true,
      }),
      getShareForResource('file', context.fileId),
    ])
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return { file, share }
  },
})
