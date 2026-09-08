import { exportWorkspaceFileSnapshotContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { exportWorkspaceFileSnapshot } from '@/lib/workspace-files/application/export-workspace-file-snapshot'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const POST = defineInternalBinaryRoute({
  contract: exportWorkspaceFileSnapshotContract,
  auth: internalSessionAuth,
  operation: exportWorkspaceFileSnapshot.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve internal file download behavior' }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    content: body.content,
  }),
  useCase: exportWorkspaceFileSnapshot,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'file_downloaded',
      {
        workspace_id: result.file.workspaceId,
        is_bulk: result.assetCount > 0,
        file_count: 1 + result.assetCount,
      },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  present: ({ buffer, fileName, contentType }) => ({
    body: new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength),
    contentType,
    contentLength: buffer.length,
    contentDisposition: `attachment; ${encodeFilenameForHeader(fileName)}`,
    headers: { 'Cache-Control': 'private, no-store' },
  }),
})
