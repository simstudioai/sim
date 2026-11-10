/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  type ChunkPage,
  locateCreatedChunk,
} from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/[documentId]/_components/document-view/chunk-arrival'

function pages(byNumber: Record<number, ChunkPage>) {
  return vi.fn(async (page: number) => {
    const found = byNumber[page]
    if (!found) throw new Error(`page ${page} was not expected`)
    return found
  })
}

describe('locateCreatedChunk', () => {
  it('finds the chunk on the last page it was created from', async () => {
    const fetchPage = pages({ 3: { chunks: [{ id: 'a' }, { id: 'new' }], totalPages: 3 } })
    await expect(locateCreatedChunk('new', 3, fetchPage)).resolves.toBe(3)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('follows the chunk onto the page it spilled to', async () => {
    const fetchPage = pages({
      3: { chunks: [{ id: 'a' }], totalPages: 4 },
      4: { chunks: [{ id: 'new' }], totalPages: 4 },
    })
    await expect(locateCreatedChunk('new', 3, fetchPage)).resolves.toBe(4)
  })

  it('gives up without retrying when no page holds the chunk', async () => {
    const fetchPage = pages({
      3: { chunks: [{ id: 'a' }], totalPages: 4 },
      4: { chunks: [{ id: 'b' }], totalPages: 4 },
    })
    await expect(locateCreatedChunk('new', 3, fetchPage)).resolves.toBeNull()
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('rejects when a page read fails instead of swallowing it', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('chunks unavailable')
    })
    await expect(locateCreatedChunk('new', 1, fetchPage)).rejects.toThrow('chunks unavailable')
  })
})
