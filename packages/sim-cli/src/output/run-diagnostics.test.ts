import { describe, expect, it, vi } from 'vitest'
import { summarizeRun } from '#sim-cli/output/run-diagnostics'

describe('compact run diagnostics', () => {
  it.each([null, 'complete', { delivered: false }, { result: { candidateId: 'candidate-1' } }])(
    'retains existing final output without requiring an application-specific field: %j',
    (finalOutput) => {
      expect(summarizeRun({ status: 'completed', finalOutput })).toMatchObject({
        executionStatus: 'completed',
        finalOutput,
        truncated: false,
      })
    }
  )

  it('shows nested failures and observed effects without printing binary fields', () => {
    const result = summarizeRun({
      status: 'completed',
      traceSpans: [
        {
          name: 'workflow',
          children: [
            {
              blockId: 'render',
              name: 'Renderer',
              status: 'error',
              errorHandled: true,
              errorMessage: 'Invalid regular expression flags',
              input: { file: { name: 'test.pdf', data: 'SECRET_BYTES' } },
              output: { base64: 'MORE_BYTES' },
            },
            { blockId: 'notify', name: 'Send failure', status: 'success' },
          ],
        },
      ],
      files: [{ id: 'file-1', name: 'test.pdf', base64: 'BYTES' }],
    })
    expect(result.failures).toMatchObject([
      { blockId: 'render', handled: true, error: 'Invalid regular expression flags' },
    ])
    expect(result.observedBlocks).toMatchObject([{ blockId: 'render' }, { blockId: 'notify' }])
    expect(JSON.stringify(result)).not.toContain('SECRET_BYTES')
    expect(JSON.stringify(result)).not.toContain('MORE_BYTES')
    expect(result.files).toEqual([{ id: 'file-1', name: 'test.pdf', base64: '[binary omitted]' }])
  })

  it('bounds wide/deep traces, long text, and nested output values', () => {
    const result = summarizeRun({
      traceSpans: Array.from({ length: 1000 }, (_, i) => ({
        blockId: String(i),
        name: 'test',
        status: 'failed',
        errorMessage: 'x'.repeat(10000),
        output: { a: { b: { c: { d: { e: 'deep' } } } } },
      })),
    })
    expect(result.truncated).toBe(true)
    expect(result.failures).toHaveLength(10)
    expect(result.observedBlocks).toHaveLength(100)
    expect(JSON.stringify(result).length).toBeLessThan(25000)
  })

  it('stops reading object values after the field limit and reports truncation', () => {
    const outcome = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`field_${index}`, index])
    )
    const beyondLimit = vi.fn(() => {
      throw new Error('Fields beyond the diagnostic limit must not be read')
    })
    Object.defineProperty(outcome, 'beyondLimit', { enumerable: true, get: beyondLimit })

    const result = summarizeRun({ finalOutput: outcome })

    expect(beyondLimit).not.toHaveBeenCalled()
    expect(Object.keys(result.finalOutput as Record<string, unknown>)).toHaveLength(12)
    expect(result.finalOutput).toMatchObject({ field_0: 0, field_11: 11 })
    expect(result.truncated).toBe(true)
  })

  it('retains structured data under named or typed records while omitting encoded Buffer bytes', () => {
    const result = summarizeRun({
      finalOutput: {
        named: { name: 'delivery', data: { status: 'blocked', reason: 'membership' } },
        typed: { type: 'result', data: [{ sent: false }] },
        counts: { name: 'attempts', data: [1, 2, 3] },
        buffer: { type: 'Buffer', data: [80, 68, 70] },
      },
    })
    expect(result.finalOutput).toEqual({
      named: { name: 'delivery', data: { status: 'blocked', reason: 'membership' } },
      typed: { type: 'result', data: [{ sent: false }] },
      counts: { name: 'attempts', data: [1, 2, 3] },
      buffer: { type: 'Buffer', data: '[binary omitted]' },
    })
  })
})
