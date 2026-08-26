import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'

/**
 * Resolves a generation-source record to its compiled artifact.
 *
 * The record's declared size bounds nothing here — a source is text and orders
 * of magnitude smaller than what it renders to — so the artifact is checked
 * against the ceiling the caller is serving under. Note this rejects an
 * oversized artifact rather than preventing it being read: the artifact store
 * fetch is not itself streaming-bounded, so the bytes are resident before the
 * check rejects them.
 *
 * An artifact that is still compiling is retryable rather than a fault, so it
 * surfaces as `conflict` — a 500 would give the caller no reason to try again.
 * A generation script that failed permanently raises the same error class but
 * will never succeed on a retry, so it keeps its own message instead of the
 * "still being generated" copy, which would tell the caller to wait for an
 * artifact that never appears. It stays a `conflict` only because the v2
 * envelope has no 422; the message is what distinguishes the two.
 *
 * Shared by every surface that reads a workspace file's bytes, because
 * dispatching on the stored name alone hands back generator source under a
 * document extension — as text, as a download, or as a parse.
 */
export async function resolveRenderedWorkspaceArtifact(
  file: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; tooLargeMessage?: (limit: string) => string }
): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    return await fetchAuthorizedServableWorkspaceFileBuffer(file, filePrincipal, {
      maxBytes: options.maxBytes,
    })
  } catch (error) {
    if (isDocNotReadyError(error)) {
      if (error.pending) throw new OrchestrationError('conflict', docNotReadyMessage())
      throw new OrchestrationError(
        'conflict',
        `"${file.name}" could not be generated: ${error.message}`
      )
    }
    if (isPayloadSizeLimitError(error)) {
      const limit = formatFileSize(options.maxBytes)
      throw new OrchestrationError(
        'payload_too_large',
        options.tooLargeMessage?.(limit) ??
          `"${file.name}" renders to more than ${limit} and is too large to download.`
      )
    }
    throw error
  }
}
