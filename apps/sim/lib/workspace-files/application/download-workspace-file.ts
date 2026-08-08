import { AuditAction, AuditResourceType } from '@sim/audit'
import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import {
  type ActiveWorkspaceFileContext,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface DownloadWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DownloadWorkspaceFileResult {
  file: NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>
}

export interface DownloadWorkspaceFileStreamResult extends DownloadWorkspaceFileResult {
  stream: ReadableStream<Uint8Array>
}

function projectDownloadAudit(file: DownloadWorkspaceFileResult['file']) {
  return {
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Downloaded file "${file.name}"`,
    metadata: {
      fileId: file.id,
      fileName: file.name,
      bytes: file.size,
    },
  }
}

async function executeDownloadWorkspaceFile({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.download,
  DownloadWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DownloadWorkspaceFileResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file }
}

export const downloadWorkspaceFile = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDownloadWorkspaceFile,
  projectAudit: ({ result }) => projectDownloadAudit(result.file),
})

async function executeDownloadWorkspaceFileStream({
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.download,
  DownloadWorkspaceFileInput,
  ActiveWorkspaceFileContext
>): Promise<DownloadWorkspaceFileStreamResult> {
  const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const stream = await downloadFileStream({
    key: file.key,
    context: file.storageContext ?? 'workspace',
  })
  return { file, stream: nodeReadableToWebStream(stream) }
}

/** Authorized and audited binary download without materializing the file in memory. */
export const downloadWorkspaceFileStream = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.download,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeDownloadWorkspaceFileStream,
  projectAudit: ({ result }) => projectDownloadAudit(result.file),
})
