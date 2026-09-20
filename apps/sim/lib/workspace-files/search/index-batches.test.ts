/** @vitest-environment node */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FILE_SEARCH_CHUNK_BYTES,
  FILE_SEARCH_INSERT_BATCH_BYTES,
  FILE_SEARCH_INSERT_BATCH_ROWS,
  FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS,
} from '@/lib/workspace-files/search/constants'
import { iterateFileSearchBatches } from '@/lib/workspace-files/search/index-batches'
import {
  estimateTrigramKeys,
  type FileSearchChunk,
  iterateFileSearchChunks,
  planFileSearchIndex,
} from '@/lib/workspace-files/search/index-plan'

const signal = new AbortController().signal
const chunk = (content: string, ordinal = 0): FileSearchChunk => ({
  content,
  ordinal,
  lineStart: ordinal + 1,
  fragment: false,
  overlap: 0,
})

/** A de Bruijn prefix has no repeated three-letter windows, exercising the padding overhead. */
function uniqueTrigrams(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const positions = Array<number>(4).fill(0)
  let text = ''
  const visit = (depth: number, period: number) => {
    if (depth > 3) {
      if (3 % period === 0) for (let i = 1; i <= period; i++) text += alphabet[positions[i]]
      return
    }
    positions[depth] = positions[depth - period]
    visit(depth + 1, period)
    for (let i = positions[depth - period] + 1; i < alphabet.length; i++) {
      positions[depth] = i
      visit(depth + 1, depth)
    }
  }
  visit(1, 1)
  return text.slice(0, FILE_SEARCH_CHUNK_BYTES)
}

describe('file search insert batches', () => {
  it('counts GIN work per row, preserving every dense lockfile line and ordinal', () => {
    const text = Array.from(
      { length: 1200 },
      (_, i) =>
        `dependency-${i}: sha512-${createHash('sha512').update(String(i)).digest('base64')}\n`
    ).join('')
    const chunks = [
      ...iterateFileSearchChunks(planFileSearchIndex({ text, partial: false }, signal), signal),
    ]
    const batches = [...iterateFileSearchBatches(chunks, signal)]
    expect(batches.length).toBeGreaterThan(
      Math.ceil(Buffer.byteLength(text) / FILE_SEARCH_INSERT_BATCH_BYTES)
    )
    expect(batches.flat()).toEqual(chunks)
    expect(
      batches
        .flat()
        .map((c) => c.content)
        .join('')
    ).toBe(text)
    for (const batch of batches) {
      expect(batch.reduce((sum, c) => sum + estimateTrigramKeys(c.content), 0)).toBeLessThanOrEqual(
        FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS
      )
    }
    const repeated = chunk(chunks[0].content)
    const sameContent = [...iterateFileSearchBatches(Array(16).fill(repeated), signal)]
    expect(sameContent.length).toBeGreaterThan(1)
  })

  it('retains byte batching for low-key text and the row bound for tiny chunks', () => {
    const full = chunk('a'.repeat(FILE_SEARCH_CHUNK_BYTES))
    const byBytes = [...iterateFileSearchBatches(Array(17).fill(full), signal)]
    expect(byBytes.map((batch) => batch.length)).toEqual([16, 1])
    const byRows = [
      ...iterateFileSearchBatches(Array(FILE_SEARCH_INSERT_BATCH_ROWS + 1).fill(chunk('')), signal),
    ]
    expect(byRows.map((batch) => batch.length)).toEqual([FILE_SEARCH_INSERT_BATCH_ROWS, 1])
  })

  it('writes a maximum-key chunk alone without splitting or dropping it', () => {
    const dense = chunk(uniqueTrigrams(), 1)
    expect(estimateTrigramKeys(dense.content)).toBeGreaterThan(
      FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS
    )
    const first = chunk('first')
    const last = chunk('last', 2)
    expect([...iterateFileSearchBatches([first, dense, last], signal)]).toEqual([
      [first],
      [dense],
      [last],
    ])
  })

  it('rejects oversized chunks and emits no empty batch', () => {
    expect([...iterateFileSearchBatches([], signal)]).toEqual([])
    expect(() => [
      ...iterateFileSearchBatches([chunk('a'.repeat(FILE_SEARCH_CHUNK_BYTES + 1))], signal),
    ]).toThrow('chunk exceeds its budget')
  })

  it('consumes only one batch plus lookahead and honors cancellation between writes', () => {
    let consumed = 0
    function* source() {
      for (let i = 0; i < 100; i++) {
        consumed++
        yield chunk('a'.repeat(FILE_SEARCH_CHUNK_BYTES), i)
      }
    }
    const controller = new AbortController()
    const batches = iterateFileSearchBatches(source(), controller.signal)
    expect(batches.next().value).toHaveLength(16)
    expect(consumed).toBe(17)
    controller.abort(new Error('canceled'))
    expect(() => batches.next()).toThrow('canceled')
    expect(consumed).toBe(17)
  })
})
