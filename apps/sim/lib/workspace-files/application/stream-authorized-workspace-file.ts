import type { Principal } from '@sim/auth/principal'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import type { ByteRange } from '@/lib/uploads/shared/types'
import { requireAdmittedWorkspaceFile } from '@/lib/workspace-files/application/admit-file-content'
import { finishFileDelivery } from '@/lib/workspace-files/application/finish-file-delivery'
import { createFileReadReceipt } from '@/lib/workspace-files/read-receipt'

/**
 * Opens an already-authorized workspace file's stored bytes for delivery, whole or as one inclusive
 * span, without reading them into memory.
 *
 * The caller has already authorized and admitted the file (`'opaque'`) through its own use case;
 * this opens nothing for a file it has not admitted.
 *
 * Access is rechecked once storage has opened and before the stream is handed out, as every
 * streamed read does: a revocation, a content write, or a provenance change landing in between
 * disposes the stream instead of publishing it. `authorize` is the caller's own use-case check, so
 * the recheck applies the same policy that admitted the file.
 */
export async function streamAuthorizedWorkspaceFile(input: {
  file: WorkspaceFileRecord
  principal: Principal
  authorize(): Promise<void>
  range?: ByteRange
}): Promise<ReadableStream<Uint8Array>> {
  const { file, principal } = input
  const stream = nodeReadableToWebStream(
    await downloadFileStream({
      key: file.key,
      context: file.storageContext ?? 'workspace',
      range: input.range,
    })
  )
  const provenance = await finishFileDelivery({
    principal,
    authorize: input.authorize,
    receipt: createFileReadReceipt({ entityType: 'workspace', entityId: file.workspaceId }, [
      { ...file, contentUpdatedAt: file.contentUpdatedAt ?? file.updatedAt },
    ]),
    stream,
  })
  try {
    await requireAdmittedWorkspaceFile(principal, file.workspaceId, file, 'opaque', provenance)
  } catch (error) {
    await stream.cancel(error).catch(() => undefined)
    throw error
  }
  return stream
}
