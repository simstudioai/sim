import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getShareForResource } from '@/lib/public-shares/share-manager'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getCurrentWorkspaceFileVersion } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
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
  currentVersion: number
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

/**
 * The same read plus the current version number, for the public metadata surface. Kept separate so
 * the many internal callers of {@link readWorkspaceFileMetadata} pay no extra query.
 */
export const readWorkspaceFileMetadataWithVersion = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({ input }: { input: ReadWorkspaceFileMetadataInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute(args): Promise<ReadWorkspaceFileMetadataWithVersionResult> {
    const result = await executeReadWorkspaceFileMetadata(args)
    const current = await getCurrentWorkspaceFileVersion(result.file)
    return { ...result, currentVersion: current.version }
  },
})
