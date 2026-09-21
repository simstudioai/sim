import { Buffer } from 'node:buffer'
import {
  FILE_SEARCH_CHUNK_BYTES,
  FILE_SEARCH_INSERT_BATCH_BYTES,
  FILE_SEARCH_INSERT_BATCH_ROWS,
  FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS,
} from '@/lib/workspace-files/search/constants'
import { estimateTrigramKeys, type FileSearchChunk } from '@/lib/workspace-files/search/index-plan'

/** A single bounded chunk must make progress even when its estimate exceeds the key target. */
export function exceedsFileSearchBatchBudget(rows: number, bytes: number, keys: number): boolean {
  return (
    rows > FILE_SEARCH_INSERT_BATCH_ROWS ||
    bytes > FILE_SEARCH_INSERT_BATCH_BYTES ||
    (rows > 1 && keys > FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS)
  )
}

/**
 * Bounds each insert's payload and estimated GIN work without changing stored chunks or coverage.
 * Keys are counted per row: repeated keys across rows still require separate posting updates.
 */
export function* iterateFileSearchBatches(
  chunks: Iterable<FileSearchChunk>,
  signal: AbortSignal
): Generator<FileSearchChunk[]> {
  let batch: FileSearchChunk[] = []
  let bytes = 0
  let keys = 0
  for (const chunk of chunks) {
    signal.throwIfAborted()
    const chunkBytes = Buffer.byteLength(chunk.content)
    if (chunkBytes > FILE_SEARCH_CHUNK_BYTES)
      throw new Error('File search chunk exceeds its budget')
    const chunkKeys = estimateTrigramKeys(chunk.content)
    if (
      batch.length &&
      exceedsFileSearchBatchBudget(batch.length + 1, bytes + chunkBytes, keys + chunkKeys)
    ) {
      yield batch
      signal.throwIfAborted()
      batch = []
      bytes = keys = 0
    }
    batch.push(chunk)
    bytes += chunkBytes
    keys += chunkKeys
  }
  signal.throwIfAborted()
  if (batch.length) yield batch
}
