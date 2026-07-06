/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaterializeRef, mockCompact, mockMaterializeManifest, mockMaskBatch } = vi.hoisted(
  () => ({
    mockMaterializeRef: vi.fn(),
    mockCompact: vi.fn(),
    mockMaterializeManifest: vi.fn(),
    mockMaskBatch: vi.fn(),
  })
)

vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: mockMaterializeRef,
}))
vi.mock('@/lib/execution/payloads/serializer', () => ({
  compactExecutionPayload: mockCompact,
}))
vi.mock('@/lib/execution/payloads/large-array-manifest', () => ({
  materializeLargeArrayManifest: mockMaterializeManifest,
}))
vi.mock('@/lib/execution/payloads/large-array-manifest-metadata', () => ({
  isLargeArrayManifest: () => false,
}))
vi.mock('@/lib/guardrails/mask-client', () => ({
  maskPIIBatchViaHttp: mockMaskBatch,
}))

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

describe('redactLargeValueRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaskBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
    // compact echoes its input so we can assert the masked content is what's re-stored.
    mockCompact.mockImplementation(async (value: unknown) => value)
  })

  it('hydrates, masks, and re-stores a large-value ref (content preserved, PII masked)', async () => {
    mockMaterializeRef.mockResolvedValue({ note: 'contact bob', id: 42 })

    const result = await redactLargeValueRefs(
      { finalOutput: REF },
      { entityTypes: ['PERSON'], language: 'en', store: STORE }
    )

    expect(mockMaterializeRef).toHaveBeenCalledWith(
      REF,
      expect.objectContaining({ executionId: 'ex-1', trackReference: false })
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
    mockMaterializeRef.mockResolvedValue({ note: 'secret@x.com' })
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
    mockMaterializeRef.mockImplementation(async (ref: { id: string }) =>
      ref.id === 'lv_aaaaaaaaaaaa' ? { note: 'call bob' } : { note: 'email amy' }
    )

    const result = await redactLargeValueRefs(
      { finalOutput: refA, traceSpans: [{ output: refB }] },
      { entityTypes: [], language: 'en', store: STORE }
    )

    expect(result.finalOutput).toEqual({ note: 'MASKED(call bob)' })
    expect((result.traceSpans as any[])[0].output).toEqual({ note: 'MASKED(email amy)' })
    expect(mockMaterializeRef).toHaveBeenCalledTimes(2)
    expect(mockCompact).toHaveBeenCalledTimes(2)
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
})

describe('redactLargeValueRefsInValue (arbitrary blockStates)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaskBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
    mockCompact.mockImplementation(async (value: unknown) => value)
  })

  it('hydrates + re-stores a ref nested in a non-RedactablePayload shape', async () => {
    mockMaterializeRef.mockResolvedValue({ note: 'contact bob' })
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
    mockMaterializeRef.mockResolvedValue({ note: 'secret@x.com' })
    mockCompact.mockRejectedValueOnce(new Error('s3 down'))

    await expect(
      redactLargeValueRefsInValue(
        { 'block-1': { output: REF } },
        { entityTypes: [], language: 'en', store: STORE, onFailure: 'throw' }
      )
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })
})
