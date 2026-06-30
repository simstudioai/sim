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

import { redactLargeValueRefs } from '@/lib/logs/execution/pii-large-values'

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
