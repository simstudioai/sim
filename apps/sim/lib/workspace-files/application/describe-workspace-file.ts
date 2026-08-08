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

export interface DescribeWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DescribeWorkspaceFileResult {
  file: WorkspaceFileRecord
  share: ShareRecord | null
}

async function executeDescribeWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.readMetadata,
  DescribeWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DescribeWorkspaceFileResult> {
  const [file, share] = await Promise.all([
    getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true }),
    getShareForResource('file', context.fileId),
  ])
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file, share }
}

export const describeWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDescribeWorkspaceFile,
})
