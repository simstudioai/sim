import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'

/** Preserves retryable generation and output-size errors across authorized artifact readers. */
export async function resolveDocumentRender<T>(
  fileName: string,
  options: { maxBytes: number; signal?: AbortSignal; tooLargeMessage?: (limit: string) => string },
  render: () => Promise<T>
): Promise<T> {
  try {
    options.signal?.throwIfAborted()
    return await render()
  } catch (error) {
    options.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      throw new OrchestrationError(
        'conflict',
        error.pending
          ? docNotReadyMessage()
          : `"${fileName}" could not be generated: ${error.message}`
      )
    }
    if (isPayloadSizeLimitError(error)) {
      const limit = formatFileSize(options.maxBytes, { includeBytes: true })
      throw new OrchestrationError(
        'payload_too_large',
        options.tooLargeMessage?.(limit) ??
          `"${fileName}" renders to more than ${limit} and is too large to download.`
      )
    }
    throw error
  }
}
