/** One page of a document's chunks, as the chunk list reads it. */
export interface ChunkPage {
  chunks: readonly { id: string }[]
  totalPages: number
}

/**
 * The page a just-created chunk is on. A new chunk is appended, so it is on the last page the list
 * had, unless it started a page of its own. Null when neither page holds it; a failed read rejects.
 */
export async function locateCreatedChunk(
  chunkId: string,
  lastPage: number,
  fetchPage: (page: number) => Promise<ChunkPage>
): Promise<number | null> {
  const last = await fetchPage(lastPage)
  if (last.chunks.some((chunk) => chunk.id === chunkId)) return lastPage
  if (last.totalPages <= lastPage) return null
  const spilled = await fetchPage(last.totalPages)
  return spilled.chunks.some((chunk) => chunk.id === chunkId) ? last.totalPages : null
}
