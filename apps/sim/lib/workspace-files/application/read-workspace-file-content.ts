import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Optional post-authorization storage ceiling for bounded binary reads. */
  maxBytes?: number
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
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readContent,
  ReadWorkspaceFileContentInput,
  ActiveWorkspaceFileContext
>): Promise<ReadWorkspaceFileContentResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    includeDeleted: input.includeDeleted,
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const content = await fetchWorkspaceFileBuffer(file, { maxBytes: input.maxBytes })
  const secretProvenance = input.includeSecretProvenance
    ? await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
        fileId: file.id,
        key: file.key,
        context: file.storageContext ?? 'workspace',
      })
    : undefined
  return {
    file,
    content,
    ...(secretProvenance ? { secretProvenance } : {}),
  }
}

export const readWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeReadWorkspaceFileContent,
})
