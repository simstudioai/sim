/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaskPIIBatch } = vi.hoisted(() => ({
  mockMaskPIIBatch: vi.fn(),
}))

vi.mock('@/lib/guardrails/mask-client', () => ({
  maskPIIBatchViaHttp: mockMaskPIIBatch,
}))

import {
  PiiRedactionError,
  REDACTION_FAILED_MARKER,
  redactObjectStrings,
  redactPIIFromExecution,
} from '@/lib/logs/execution/pii-redaction'

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

  it('masks large strings too (never left unredacted)', async () => {
    const big = 'x'.repeat(200 * 1024)
    const payload = { finalOutput: { big, small: 'pii' } }

    const result = await redactPIIFromExecution(payload, { entityTypes: [] })

    expect((result.finalOutput as any).big).toBe(`MASKED(${big})`)
    expect((result.finalOutput as any).small).toBe('MASKED(pii)')
    expect(mockMaskPIIBatch.mock.calls[0][0]).toEqual([big, 'pii'])
  })

  it('masks span error/errorMessage and top-level error, trigger, executionState, environment', async () => {
    const payload = {
      traceSpans: [{ blockId: 'b1', error: 'failed for bob@x.com', errorMessage: 'bad input z' }],
      error: 'run failed: a@b.com',
      completionFailure: 'cancelled by c@d.com',
      trigger: { type: 'webhook', data: { from: 'caller@x.com' } },
      executionState: { status: 'completed', note: 'state for e@f.com' },
      environment: { variables: { CONTACT: 'admin@x.com' } },
      correlation: { source: 'corr@x.com' },
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: ['EMAIL_ADDRESS'] })

    const span = (result.traceSpans as any[])[0]
    expect(span.blockId).toBe('b1')
    expect(span.error).toBe('MASKED(failed for bob@x.com)')
    expect(span.errorMessage).toBe('MASKED(bad input z)')
    expect(result.error).toBe('MASKED(run failed: a@b.com)')
    expect(result.completionFailure).toBe('MASKED(cancelled by c@d.com)')
    expect((result.trigger as any).type).toBe('MASKED(webhook)')
    expect((result.trigger as any).data.from).toBe('MASKED(caller@x.com)')
    expect((result.executionState as any).note).toBe('MASKED(state for e@f.com)')
    expect((result.environment as any).variables.CONTACT).toBe('MASKED(admin@x.com)')
    expect((result.correlation as any).source).toBe('MASKED(corr@x.com)')
  })

  it('returns payload unchanged when there is nothing to mask', async () => {
    const payload = { traceSpans: [{ blockId: 'b1', count: 5 }] }
    const result = await redactPIIFromExecution(payload, { entityTypes: [] })
    expect(result).toBe(payload)
    expect(mockMaskPIIBatch).not.toHaveBeenCalled()
  })
})

describe('redactObjectStrings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaskPIIBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
  })

  it('masks every string leaf and preserves structure', async () => {
    const value = { name: 'bob', nested: { email: 'a@b.com' }, list: ['x', 1, true] }
    const result = await redactObjectStrings(value, { entityTypes: ['PERSON'] })
    expect(result).toEqual({
      name: 'MASKED(bob)',
      nested: { email: 'MASKED(a@b.com)' },
      list: ['MASKED(x)', 1, true],
    })
    expect(mockMaskPIIBatch).toHaveBeenCalledTimes(1)
  })

  it('leaves non-string and empty values untouched', async () => {
    const value = { count: 5, flag: false, empty: '', nullish: null }
    const result = await redactObjectStrings(value, { entityTypes: [] })
    expect(result).toEqual(value)
    expect(mockMaskPIIBatch).not.toHaveBeenCalled()
  })

  it('throws PiiRedactionError on masking failure when onFailure is throw', async () => {
    mockMaskPIIBatch.mockRejectedValueOnce(new Error('presidio down'))
    await expect(
      redactObjectStrings({ text: 'a@b.com' }, { entityTypes: [], onFailure: 'throw' })
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })

  it('masks large payloads (no size ceiling) rather than scrubbing them', async () => {
    const big = 'x'.repeat(17 * 1024 * 1024)
    const result = (await redactObjectStrings({ big }, { entityTypes: [] })) as { big: string }
    expect(result.big).toBe(`MASKED(${big})`)
    expect(mockMaskPIIBatch).toHaveBeenCalledTimes(1)
  })

  it('scrubs (does not throw) by default on failure', async () => {
    mockMaskPIIBatch.mockRejectedValueOnce(new Error('presidio down'))
    const result = await redactObjectStrings({ text: 'a@b.com' }, { entityTypes: [] })
    expect(result).toEqual({ text: REDACTION_FAILED_MARKER })
  })
})

describe('transformStrings (via redactObjectStrings) leaves large-value refs intact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaskPIIBatch.mockImplementation(async (texts: string[]) => texts.map((t) => `MASKED(${t})`))
  })

  it('does not recurse into / corrupt a large-value ref while masking siblings', async () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_abcdef123456',
      kind: 'object',
      size: 9_000_000,
    }
    const result = (await redactObjectStrings(
      { name: 'bob', big: ref },
      { entityTypes: ['PERSON'] }
    )) as any
    expect(result.name).toBe('MASKED(bob)')
    // The ref is left byte-for-byte intact (its key/id are not masked).
    expect(result.big).toEqual(ref)
  })
})
