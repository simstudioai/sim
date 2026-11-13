/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { shareReadBudget } from '@/lib/knowledge/mcp/read-budget'

const read = (characters: number, text = 'x') => ({
  documentId: `doc-${characters}`,
  chunks: [
    {
      chunkIndex: 0,
      content: text.repeat(characters),
      startOffset: 0,
      endOffset: characters,
      totalCharacters: characters * 2,
    },
  ],
  hasMore: false,
  next: null,
})

const lengths = (reads: { chunks: { content: string }[] }[]) =>
  reads.map((entry) => entry.chunks[0]?.content.length)

describe('shareReadBudget', () => {
  it('returns every read whole when the call fits its budget', () => {
    const reads = [read(20_000), read(15_000), read(4_000)]
    expect(shareReadBudget(reads)).toEqual(reads)
  })

  it('gives the budget short documents leave unused to the long one', () => {
    const shared = shareReadBudget([read(20_000), read(20_000), ...Array(4).fill(read(1_000))])
    expect(lengths(shared)).toEqual([18_000, 18_000, 1_000, 1_000, 1_000, 1_000])
  })

  it('cuts long documents to an equal share and continues each where it stops', () => {
    const [first] = shareReadBudget([read(20_000), read(20_000), read(20_000), read(20_000)])
    expect(first?.chunks[0]).toMatchObject({ endOffset: 10_000 })
    expect(first?.chunks[0]?.content).toHaveLength(10_000)
    expect(first).toMatchObject({
      hasMore: true,
      next: { startChunkIndex: 0, startOffset: 10_000 },
    })
  })

  it('never cuts a document below the standard page', () => {
    expect(lengths(shareReadBudget(Array(6).fill(read(20_000))))).toEqual(Array(6).fill(8_000))
  })

  it('counts text as JSON encodes it', () => {
    const [quoted] = shareReadBudget([read(30_000, '"'), read(1_000), read(1_000)])
    const content = quoted?.chunks[0]?.content ?? ''
    expect(JSON.stringify(content).length - 2).toBeLessThanOrEqual(38_000)
    expect(content.length).toBeGreaterThan(18_000)
  })

  it('keeps the call within budget when a standard page encodes beyond its share', () => {
    const shared = shareReadBudget([read(10_000, '"'), read(20_000), read(20_000), read(20_000)])
    const encoded = shared.reduce(
      (total, entry) => total + JSON.stringify(entry.chunks[0]?.content ?? '').length - 2,
      0
    )
    expect(encoded).toBeLessThanOrEqual(40_000)
    expect(lengths(shared)).toEqual([8_000, 8_000, 8_000, 8_000])
  })

  it('passes a failed read through and leaves its share to the others', () => {
    const failed = { documentId: 'missing', error: 'Not found' }
    const shared = shareReadBudget([failed, read(20_000), read(20_000), read(20_000)])
    expect(shared[0]).toBe(failed)
    expect(lengths(shared.slice(1) as ReturnType<typeof read>[])).toEqual([13_333, 13_333, 13_333])
  })
})
