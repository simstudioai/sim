import { describe, expect, it } from 'vitest'
import { summarizeRun } from '#sim-cli/output/run-diagnostics'

describe('compact run diagnostics', () => {
  it.each(['result', 'data'])(
    'reads an explicit outcome inside the standard %s wrapper',
    (field) => {
      expect(
        summarizeRun({
          status: 'completed',
          finalOutput: {
            [field]: { applicationOutcome: { status: 'delivered', fileIds: ['file-1'] } },
          },
        }).applicationOutcome
      ).toEqual({ status: 'delivered', fileIds: ['file-1'] })
    }
  )

  it('prefers a top-level explicit outcome over wrapped values', () => {
    expect(
      summarizeRun({
        finalOutput: {
          applicationOutcome: 'verification_blocked',
          result: { applicationOutcome: 'delivered' },
        },
      }).applicationOutcome
    ).toBe('verification_blocked')
  })
  it('keeps execution and an explicit application outcome separate', () => {
    const result = summarizeRun({
      runId: 'run-1',
      status: 'completed',
      finalOutput: {
        applicationOutcome: { status: 'verification_blocked', threadId: 'thread-1', fileIds: [] },
      },
      traceSpans: [],
    })
    expect(result).toMatchObject({
      executionStatus: 'completed',
      applicationOutcome: { status: 'verification_blocked', threadId: 'thread-1' },
      truncated: false,
    })
    expect(
      summarizeRun({ status: 'completed', finalOutput: { delivered: true } }).applicationOutcome
    ).toBeNull()
  })

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
})
