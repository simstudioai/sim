import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getKnowledgeChunkContract } from '@/lib/api/contracts/knowledge'

/**
 * A chunk's stored content, read fresh rather than from the list's cache, so an editor that was in
 * the background can tell whether someone else changed it. `null` when the read is refused or
 * aborted: the editor keeps what it has.
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
    if (signal.aborted || isApiClientError(error)) return null
    throw error
  }
}
