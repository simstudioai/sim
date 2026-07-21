/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaterializeRef, mockStoreLargeValue, mockCompact, mockMaskBatch } = vi.hoisted(() => ({
  mockMaterializeRef: vi.fn(),
  mockStoreLargeValue: vi.fn(),
  mockCompact: vi.fn(),
  mockMaskBatch: vi.fn(),
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: mockMaterializeRef,
  storeLargeValue: mockStoreLargeValue,
}))
vi.mock('@/lib/execution/payloads/serializer', () => ({
  compactExecutionPayload: mockCompact,
}))
vi.mock('@/lib/execution/payloads/materialization.server', () => {
  const MAX_INLINE_MATERIALIZATION_BYTES = 16 * 1024 * 1024
  return {
    MAX_INLINE_MATERIALIZATION_BYTES,
    MAX_DURABLE_LARGE_VALUE_BYTES: 64 * 1024 * 1024,
    assertInlineMaterializationSize: (size: number, maxBytes?: number) => {
      if (size > (maxBytes ?? MAX_INLINE_MATERIALIZATION_BYTES)) {
        throw new Error('Execution memory limit exceeded. Reduce payload size and try again.')
      }
    },
  }
})
vi.mock('@/lib/guardrails/mask-client', () => ({
  maskPIIBatchViaHttp: mockMaskBatch,
}))

import type { LargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  redactLargeValueRefs,
  redactLargeValueRefsInValue,
} from '@/lib/logs/execution/pii-large-values'
import { PiiRedactionError } from '@/lib/logs/execution/pii-redaction'

const REF = {
  __simLargeValueRef: true,
  version: 1,
  id: 'lv_abcdef123456',
  kind: 'object',
  size: 9_000_000,
} as const

const STORE = { workspaceId: 'ws-1', workflowId: 'wf-1', executionId: 'ex-1', userId: 'u-1' }

/** Chunk arrays keyed by ref id, served by mockMaterializeRef and captured by mockStoreLargeValue. */
const chunkData = new Map<string, unknown>()
let storedRefCounter = 0

function makeChunkRef(id: string, size: number, kind = 'array') {
  return { __simLargeValueRef: true, version: 1, id, kind, size } as const
}

function makeManifest(
  chunks: Array<{ id: string; size: number; items: unknown[] }>
): LargeArrayManifest {
  for (const chunk of chunks) {
    chunkData.set(chunk.id, chunk.items)
  }
  return {
    __simLargeArrayManifest: true,
    version: 2,
    kind: 'array',
    totalCount: chunks.reduce((sum, c) => sum + c.items.length, 0),
    chunkCount: chunks.length,
    byteSize: chunks.reduce((sum, c) => sum + c.size, 0),
    chunks: chunks.map((c) => ({
      ref: makeChunkRef(c.id, c.size),
      count: c.items.length,
      byteSize: c.size,
    })),
    preview: [{ note: 'raw unmasked preview' }],
  }
}

function installDefaultMocks() {
  mockMaskBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
  // compact echoes its input so we can assert the masked content is what's re-stored.
  mockCompact.mockImplementation(async (value: unknown) => value)
  mockMaterializeRef.mockImplementation(async (ref: { id: string }) => chunkData.get(ref.id))
  mockStoreLargeValue.mockImplementation(async (value: unknown, _json: string, size: number) => {
    const id = `lv_${String(storedRefCounter++).padStart(12, '0')}`
    chunkData.set(id, value)
    return { __simLargeValueRef: true, version: 1, id, kind: 'array', size }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  chunkData.clear()
  storedRefCounter = 0
  installDefaultMocks()
})

describe('redactLargeValueRefs', () => {
  it('hydrates, masks, and re-stores a large-value ref (content preserved, PII masked)', async () => {
    chunkData.set(REF.id, { note: 'contact bob', id: 42 })

    const result = await redactLargeValueRefs(
      { finalOutput: REF },
      { entityTypes: ['PERSON'], language: 'en', store: STORE }
    )

    expect(mockMaterializeRef).toHaveBeenCalledWith(
      REF,
      expect.objectContaining({
        executionId: 'ex-1',
        trackReference: false,
        maxBytes: 64 * 1024 * 1024,
      })
    )
    expect(result.finalOutput).toEqual({ note: 'MASKED(contact bob)', id: 42 })
    expect(mockCompact).toHaveBeenCalledTimes(1)
  })

  it('falls back to the marker when a ref cannot be materialized', async () => {
    mockMaterializeRef.mockResolvedValue(undefined)
    const result = await redactLargeValueRefs(
      { finalOutput: REF },
      { entityTypes: [], language: 'en', store: STORE }
    )
    expect(result.finalOutput).toBe('[REDACTION_FAILED]')
    expect(mockCompact).not.toHaveBeenCalled()
  })

  it('falls back to the marker when re-store throws (never leaks)', async () => {
    chunkData.set(REF.id, { note: 'secret@x.com' })
    mockCompact.mockRejectedValueOnce(new Error('s3 down'))
    const result = await redactLargeValueRefs(
      { finalOutput: REF },
      { entityTypes: [], language: 'en', store: STORE }
    )
    expect(result.finalOutput).toBe('[REDACTION_FAILED]')
  })

  it('hydrates+masks refs across multiple payload keys (parallel, cross-key)', async () => {
    const refA = { ...REF, id: 'lv_aaaaaaaaaaaa' }
    const refB = { ...REF, id: 'lv_bbbbbbbbbbbb' }
    chunkData.set(refA.id, { note: 'call bob' })
    chunkData.set(refB.id, { note: 'email amy' })

    const result = await redactLargeValueRefs(
      { finalOutput: refA, traceSpans: [{ output: refB }] },
      { entityTypes: [], language: 'en', store: STORE }
    )

    expect(result.finalOutput).toEqual({ note: 'MASKED(call bob)' })
    expect((result.traceSpans as any[])[0].output).toEqual({ note: 'MASKED(email amy)' })
    expect(mockMaterializeRef).toHaveBeenCalledTimes(2)
    expect(mockCompact).toHaveBeenCalledTimes(2)
  })

  it('aborts (throws) when one of several refs fails in throw mode', async () => {
    const refA = { ...REF, id: 'lv_aaaaaaaaaaaa' }
    const refB = { ...REF, id: 'lv_bbbbbbbbbbbb' }
    // refA materializes fine; refB can't — in throw mode the whole redaction must abort.
    chunkData.set(refA.id, { note: 'ok' })

    await expect(
      redactLargeValueRefs(
        { finalOutput: refA, traceSpans: [{ output: refB }] },
        { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
      )
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })

  it('leaves payloads without refs untouched', async () => {
    const payload = { finalOutput: { answer: 'world', count: 5 } }
    const result = await redactLargeValueRefs(payload, {
      entityTypes: [],
      language: 'en',
      store: STORE,
    })
    expect(result).toEqual(payload)
    expect(mockMaterializeRef).not.toHaveBeenCalled()
  })

  it('masks a single ref past the inline ceiling with the raised durable budget', async () => {
    const bigRef = { ...REF, id: 'lv_bigbigbigbig', size: 30 * 1024 * 1024 }
    chunkData.set(bigRef.id, { note: 'ssn 123-45-6789' })

    const result = await redactLargeValueRefs(
      { finalOutput: bigRef },
      { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
    )

    expect(mockMaterializeRef).toHaveBeenCalledWith(
      bigRef,
      expect.objectContaining({ maxBytes: 64 * 1024 * 1024 })
    )
    expect(result.finalOutput).toEqual({ note: 'MASKED(ssn 123-45-6789)' })
  })

  it('processes oversized single refs serially, after the pooled refs', async () => {
    const smallRef = { ...REF, id: 'lv_smallsmall12' }
    const bigRef = { ...REF, id: 'lv_bigbigbigbig', size: 30 * 1024 * 1024 }
    chunkData.set(smallRef.id, { note: 'small' })
    chunkData.set(bigRef.id, { note: 'big' })

    await redactLargeValueRefs(
      { finalOutput: { a: bigRef, b: smallRef } },
      { entityTypes: [], language: 'en', store: STORE }
    )

    const order = mockMaterializeRef.mock.calls.map(([ref]) => (ref as { id: string }).id)
    expect(order).toEqual(['lv_smallsmall12', 'lv_bigbigbigbig'])
  })
})

describe('redactManifest — chunk-wise', () => {
  it('masks a >16MB manifest chunk-by-chunk without tripping the inline ceiling', async () => {
    const manifest = makeManifest([
      { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'alpha' }, { note: 'beta' }] },
      { id: 'lv_chunk1chunk1', size: 9_000_000, items: [{ note: 'gamma' }, { note: 'delta' }] },
      { id: 'lv_chunk2chunk2', size: 9_000_000, items: [{ note: 'omega' }] },
    ])

    const result = await redactLargeValueRefs(
      { finalOutput: manifest },
      { entityTypes: ['PERSON'], language: 'en', store: STORE, onFailure: 'throw' }
    )

    const masked = result.finalOutput as LargeArrayManifest
    expect(isLargeArrayManifest(masked)).toBe(true)
    expect(masked.totalCount).toBe(5)

    const maskedItems = masked.chunks.flatMap((chunk) => chunkData.get(chunk.ref.id) as unknown[])
    expect(maskedItems).toEqual([
      { note: 'MASKED(alpha)' },
      { note: 'MASKED(beta)' },
      { note: 'MASKED(gamma)' },
      { note: 'MASKED(delta)' },
      { note: 'MASKED(omega)' },
    ])
    // Manifests re-store through the manifest writer, never the whole-value serializer.
    expect(mockCompact).not.toHaveBeenCalled()
    // One hydration per source chunk, read-only and with the raised per-chunk budget.
    const chunkReads = mockMaterializeRef.mock.calls.filter(([ref]) =>
      String((ref as { id: string }).id).startsWith('lv_chunk')
    )
    expect(chunkReads).toHaveLength(3)
    for (const [, context] of chunkReads) {
      expect(context).toMatchObject({ trackReference: false, maxBytes: 64 * 1024 * 1024 })
    }
  })

  it('derives the rebuilt preview from masked items, never the raw source preview', async () => {
    const manifest = makeManifest([
      { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'bob smith' }] },
      { id: 'lv_chunk1chunk1', size: 9_000_000, items: [{ note: 'amy jones' }] },
    ])

    const result = await redactLargeValueRefs(
      { finalOutput: manifest },
      { entityTypes: ['PERSON'], language: 'en', store: STORE }
    )

    const masked = result.finalOutput as LargeArrayManifest
    expect(masked.preview).toEqual([{ note: 'MASKED(bob smith)' }])
  })

  it('returns an empty manifest unchanged in shape for a zero-item manifest', async () => {
    const empty: LargeArrayManifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 0,
      chunkCount: 0,
      byteSize: 0,
      chunks: [],
      preview: [],
    }

    const result = await redactLargeValueRefs(
      { finalOutput: empty },
      { entityTypes: [], language: 'en', store: STORE }
    )

    const masked = result.finalOutput as LargeArrayManifest
    expect(isLargeArrayManifest(masked)).toBe(true)
    expect(masked.totalCount).toBe(0)
    expect(mockStoreLargeValue).not.toHaveBeenCalled()
  })

  it('recursively masks a nested large-value ref inside a chunk item', async () => {
    const nestedRef = { ...REF, id: 'lv_nestednested' }
    chunkData.set(nestedRef.id, { note: 'nested bob' })
    const manifest = makeManifest([
      { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'top', deep: nestedRef }] },
    ])

    const result = await redactLargeValueRefs(
      { finalOutput: manifest },
      { entityTypes: [], language: 'en', store: STORE }
    )

    const masked = result.finalOutput as LargeArrayManifest
    const [item] = chunkData.get(masked.chunks[0].ref.id) as Array<Record<string, unknown>>
    expect(item.note).toBe('MASKED(top)')
    expect(item.deep).toEqual({ note: 'MASKED(nested bob)' })
  })

  describe('partial chunk failure', () => {
    it('scrubs the whole manifest to the marker in scrub mode', async () => {
      const manifest = makeManifest([
        { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'ok' }] },
        { id: 'lv_chunk1chunk1', size: 9_000_000, items: [{ note: 'lost' }] },
      ])
      chunkData.delete('lv_chunk1chunk1')

      const result = await redactLargeValueRefs(
        { finalOutput: manifest },
        { entityTypes: [], language: 'en', store: STORE }
      )

      expect(result.finalOutput).toBe('[REDACTION_FAILED]')
    })

    it('throws PiiRedactionError in throw mode', async () => {
      const manifest = makeManifest([
        { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'ok' }] },
        { id: 'lv_chunk1chunk1', size: 9_000_000, items: [{ note: 'lost' }] },
      ])
      chunkData.delete('lv_chunk1chunk1')

      await expect(
        redactLargeValueRefs(
          { finalOutput: manifest },
          { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
        )
      ).rejects.toBeInstanceOf(PiiRedactionError)
    })
  })

  it('fails fast when a chunk materializes with the wrong item count', async () => {
    const manifest = makeManifest([
      { id: 'lv_chunk0chunk0', size: 9_000_000, items: [{ note: 'a' }, { note: 'b' }] },
    ])
    chunkData.set('lv_chunk0chunk0', [{ note: 'a' }])

    const result = await redactLargeValueRefs(
      { finalOutput: manifest },
      { entityTypes: [], language: 'en', store: STORE }
    )

    expect(result.finalOutput).toBe('[REDACTION_FAILED]')
  })
})

describe('redactLargeValueRefsInValue (arbitrary blockStates)', () => {
  it('hydrates + re-stores a ref nested in a non-RedactablePayload shape', async () => {
    chunkData.set(REF.id, { note: 'contact bob' })
    const blockStates = { 'block-1': { output: REF }, 'block-2': { output: { plain: 'hi' } } }

    const result = await redactLargeValueRefsInValue(blockStates, {
      entityTypes: ['PERSON'],
      language: 'en',
      store: STORE,
    })

    expect((result as any)['block-1'].output).toEqual({ note: 'MASKED(contact bob)' })
    expect((result as any)['block-2'].output).toEqual({ plain: 'hi' })
  })

  it('throws PiiRedactionError on failure when onFailure is throw (aborts resume, no marker)', async () => {
    mockMaterializeRef.mockResolvedValue(undefined)

    await expect(
      redactLargeValueRefsInValue(
        { 'block-1': { output: REF } },
        { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
      )
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })

  it('rethrows a re-store failure as PiiRedactionError under throw mode', async () => {
    chunkData.set(REF.id, { note: 'secret@x.com' })
    mockCompact.mockRejectedValueOnce(new Error('s3 down'))

    await expect(
      redactLargeValueRefsInValue(
        { 'block-1': { output: REF } },
        { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
      )
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })
})
