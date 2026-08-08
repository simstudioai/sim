import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { downloadWorkspaceFileRecord } from '@/lib/workspace-files/application/read-workspace-file-record'

export interface DownloadWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DownloadWorkspaceFileResult {
  file: Awaited<ReturnType<typeof downloadWorkspaceFileRecord.execute>>['file']
}

export interface DownloadWorkspaceFileStreamResult extends DownloadWorkspaceFileResult {
  stream: ReadableStream<Uint8Array>
}

function recordDownloadAudit(
  file: DownloadWorkspaceFileResult['file'],
  principal: Principal,
  request?: OrchestrationRequestContext
) {
  const auditAttribution = resolvePrincipalAuditAttribution(principal)

  recordAudit({
    workspaceId: file.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Downloaded file "${file.name}"`,
    metadata: {
      fileId: file.id,
      fileName: file.name,
      bytes: file.size,
      actor: auditAttribution.actor,
    },
    request,
  })
}

async function executeDownloadWorkspaceFile({
  principal,
  input,
  request,
}: {
  principal: Principal
  input: DownloadWorkspaceFileInput
  request?: OrchestrationRequestContext
}): Promise<DownloadWorkspaceFileResult> {
  const result = await downloadWorkspaceFileRecord.execute({ principal, input, request })
  recordDownloadAudit(result.file, principal, request)
  return { file: result.file }
}

export const downloadWorkspaceFile = {
  operation: downloadWorkspaceFileRecord.operation,
  execute: executeDownloadWorkspaceFile,
} as const

async function executeDownloadWorkspaceFileStream({
  principal,
  input,
  request,
}: {
  principal: Principal
  input: DownloadWorkspaceFileInput
  request?: OrchestrationRequestContext
}): Promise<DownloadWorkspaceFileStreamResult> {
  const result = await downloadWorkspaceFileRecord.execute({
    principal,
    input,
    request,
  })
  const stream = await downloadFileStream({
    key: result.file.key,
    context: result.file.storageContext ?? 'workspace',
  })
  recordDownloadAudit(result.file, principal, request)
  return { file: result.file, stream: nodeReadableToWebStream(stream) }
}

/** Authorized and audited binary download without materializing the file in memory. */
export const downloadWorkspaceFileStream = {
  operation: downloadWorkspaceFileRecord.operation,
  execute: executeDownloadWorkspaceFileStream,
} as const
