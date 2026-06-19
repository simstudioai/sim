/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaskPIIBatch } = vi.hoisted(() => ({
  mockMaskPIIBatch: vi.fn(),
}))

vi.mock('@/lib/guardrails/validate_pii', () => ({
  maskPIIBatch: mockMaskPIIBatch,
}))

import { REDACTION_FAILED_MARKER, redactPIIFromExecution } from '@/lib/logs/execution/pii-redaction'

describe('redactPIIFromExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: echo each input uppercased so we can assert substitution by position.
    mockMaskPIIBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
  })

  it('collects and masks string leaves recursively, preserving structure', async () => {
    const payload = {
      traceSpans: [
        {
          blockId: 'b1',
          status: 'success',
          input: { email: 'a@b.com' },
          output: { text: 'hello' },
          children: [{ blockId: 'c1', output: { nested: 'deep' } }],
        },
      ],
      finalOutput: { answer: 'world' },
      workflowInput: 'start',
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: ['EMAIL_ADDRESS'] })

    const span = (result.traceSpans as any[])[0]
    expect(span.blockId).toBe('b1')
    expect(span.status).toBe('success')
    expect(span.input.email).toBe('MASKED(a@b.com)')
    expect(span.output.text).toBe('MASKED(hello)')
    expect(span.children[0].output.nested).toBe('MASKED(deep)')
    expect((result.finalOutput as any).answer).toBe('MASKED(world)')
    expect(result.workflowInput).toBe('MASKED(start)')
    expect(mockMaskPIIBatch).toHaveBeenCalledTimes(1)
    expect(mockMaskPIIBatch.mock.calls[0][0]).toEqual([
      'a@b.com',
      'hello',
      'deep',
      'world',
      'start',
    ])
  })

  it('does not mutate the original payload', async () => {
    const payload = { finalOutput: { answer: 'world' } }
    await redactPIIFromExecution(payload, { entityTypes: [] })
    expect(payload.finalOutput.answer).toBe('world')
  })

  it('scrubs all eligible strings when masking throws (no leak)', async () => {
    mockMaskPIIBatch.mockRejectedValueOnce(new Error('presidio down'))
    const payload = {
      traceSpans: [{ output: { text: 'secret@x.com' } }],
      finalOutput: 'another secret',
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: [] })

    expect((result.traceSpans as any[])[0].output.text).toBe(REDACTION_FAILED_MARKER)
    expect(result.finalOutput).toBe(REDACTION_FAILED_MARKER)
  })

  it('skips oversized strings without consuming a masked slot', async () => {
    const huge = 'x'.repeat(200 * 1024)
    const payload = { finalOutput: { big: huge, small: 'pii' } }

    const result = await redactPIIFromExecution(payload, { entityTypes: [] })

    expect((result.finalOutput as any).big).toBe(huge)
    expect((result.finalOutput as any).small).toBe('MASKED(pii)')
    expect(mockMaskPIIBatch.mock.calls[0][0]).toEqual(['pii'])
  })

  it('returns payload unchanged when there is nothing to mask', async () => {
    const payload = { traceSpans: [{ blockId: 'b1', count: 5 }] }
    const result = await redactPIIFromExecution(payload, { entityTypes: [] })
    expect(result).toBe(payload)
    expect(mockMaskPIIBatch).not.toHaveBeenCalled()
  })
})
