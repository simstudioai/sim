import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getKnowledgeChunkContract } from '@/lib/api/contracts/knowledge'

/**
 * A chunk's stored content, read fresh rather than from the list's cache, so an editor that was in
 * the background can tell whether someone else changed it. `null` when the read is aborted or the
 * chunk is refused or gone: the editor keeps what it has. Any other failure rejects.
 */
export async function readChunkContent(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const result = await requestJson(getKnowledgeChunkContract, {
      params: { id: knowledgeBaseId, documentId, chunkId },
      signal,
    })
    return result.data.content ?? ''
  } catch (error) {
    if (signal.aborted) return null
    if (isApiClientError(error) && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}
