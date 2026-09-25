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
              input: {
                file: { name: 'test.pdf', mimeType: 'application/pdf', data: 'SECRET_BYTES' },
              },
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

  it('retains explicit failures from legacy tool calls on a successful span', () => {
    const result = summarizeRun({
      status: 'completed',
      traceSpans: [
        {
          blockId: 'agent-1',
          name: 'Agent',
          type: 'agent',
          status: 'success',
          toolCalls: [
            {
              name: 'slack_message',
              status: 'error',
              error: 'not_in_channel',
              input: { channel: 'C123', text: 'Hello' },
              output: { ok: false },
            },
            {
              name: 'slack_message',
              status: 'success',
              output: { error: 'An ordinary output field' },
            },
          ],
        },
      ],
    })

    expect(result.executionStatus).toBe('completed')
    expect(result.observedBlocks).toEqual([
      { blockId: 'agent-1', name: 'Agent', status: 'success' },
    ])
    expect(result.failures).toEqual([
      {
        blockId: 'agent-1',
        name: 'slack_message',
        status: 'error',
        error: 'not_in_channel',
        handled: false,
        input: { channel: 'C123', text: 'Hello' },
        output: { ok: false },
      },
    ])
    expect(result.truncated).toBe(false)
  })

  it('preserves explicit recovery and bounds legacy tool-call input and output', () => {
    const result = summarizeRun({
      traceSpans: [
        {
          blockId: 'agent-1',
          status: 'success',
          errorHandled: true,
          toolCalls: [
            {
              name: 'render',
              error: 'Invalid export',
              input: { prompt: 'x'.repeat(500) },
              output: { fileBase64: 'FILE_BYTES' },
            },
          ],
        },
      ],
    })

    expect(result.failures).toMatchObject([
      {
        blockId: 'agent-1',
        name: 'render',
        error: 'Invalid export',
        handled: true,
        output: { fileBase64: '[binary omitted]' },
      },
    ])
    expect(JSON.stringify(result)).not.toContain('FILE_BYTES')
    expect(JSON.stringify(result)).not.toContain('x'.repeat(401))
    expect(result.truncated).toBe(true)
  })

  it('does not duplicate a span failure with its legacy tool-call error', () => {
    const result = summarizeRun({
      traceSpans: [
        {
          blockId: 'agent-1',
          name: 'Agent',
          status: 'error',
          errorMessage: 'not_in_channel',
          errorHandled: true,
          toolCalls: [{ name: 'slack_message', error: 'not_in_channel' }],
        },
      ],
    })

    expect(result.failures).toMatchObject([
      { blockId: 'agent-1', name: 'Agent', error: 'not_in_channel', handled: true },
    ])
    expect(result.failures).toHaveLength(1)
  })

  it('retains distinct legacy failures alongside modern tool children', () => {
    const result = summarizeRun({
      traceSpans: [
        {
          blockId: 'agent-1',
          name: 'Agent',
          status: 'success',
          errorHandled: true,
          toolCalls: [{ name: 'lookup', error: 'Unavailable' }],
          children: [
            {
              type: 'tool',
              name: 'lookup',
              status: 'error',
              errorMessage: 'Unavailable',
              errorHandled: true,
            },
          ],
        },
      ],
    })

    expect(result.failures).toHaveLength(2)
    expect(result.failures).toMatchObject([
      { blockId: 'agent-1', name: 'lookup', error: 'Unavailable', handled: true },
      { name: 'lookup', error: 'Unavailable', handled: true },
    ])
    expect(result.truncated).toBe(false)
  })

  it('bounds legacy call inspection across spans without reading past the limit', () => {
    const firstCalls = Array.from({ length: 60 }, () => ({ name: 'lookup' }))
    const lastCalls = Array.from({ length: 40 }, () => ({ name: 'lookup' }))
    const beyondLimit = vi.fn(() => {
      throw new Error('Tool calls beyond the diagnostic limit must not be read')
    })
    Object.defineProperty(lastCalls, 40, { get: beyondLimit })

    const result = summarizeRun({
      traceSpans: [
        { blockId: 'first', toolCalls: firstCalls },
        { blockId: 'last', toolCalls: lastCalls },
      ],
    })

    expect(beyondLimit).not.toHaveBeenCalled()
    expect(result.observedBlocks).toHaveLength(2)
    expect(result.failures).toEqual([])
    expect(result.truncated).toBe(true)
  })

  it('shares the failure budget with tool calls and ignores malformed or error-shaped data', () => {
    const result = summarizeRun({
      traceSpans: [
        { status: 'error', errorMessage: 'Block failed' },
        {
          blockId: 'agent-1',
          toolCalls: [
            null,
            { name: 'lookup', error: '' },
            { name: 'lookup', output: { error: 'Ordinary data' } },
            ...Array.from({ length: 20 }, (_, index) => ({
              name: `lookup_${index}`,
              error: 'Provider rejected the call',
            })),
          ],
        },
      ],
    })

    expect(result.failures).toHaveLength(10)
    expect(result.failures).toMatchObject([
      { error: 'Block failed' },
      ...Array.from({ length: 9 }, (_, index) => ({ name: `lookup_${index}` })),
    ])
    expect(result.truncated).toBe(true)
  })

  it.each(['finalOutput', 'files'])(
    'preserves failure metadata when %s exhausts the detail budget',
    (field) => {
      const result = summarizeRun({
        [field]: Array.from({ length: 12 }, () =>
          Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => 'detail'))
        ),
        traceSpans: [
          {
            blockId: 'failed-1',
            name: 'Send message',
            status: 'error',
            errorMessage: 'not_in_channel',
            errorHandled: true,
          },
          {
            blockId: 'agent-1',
            status: 'success',
            toolCalls: [{ name: 'lookup', status: 'error', error: 'Rate limited' }],
          },
        ],
      })

      expect(result.failures).toMatchObject([
        {
          blockId: 'failed-1',
          name: 'Send message',
          status: 'error',
          error: 'not_in_channel',
          handled: true,
        },
        {
          blockId: 'agent-1',
          name: 'lookup',
          status: 'error',
          error: 'Rate limited',
          handled: false,
        },
      ])
      expect(result.truncated).toBe(true)
    }
  )

  it('preserves later failure metadata when an earlier failure has large input and output', () => {
    const largeValue = Array.from({ length: 12 }, () =>
      Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => 'detail'))
    )
    const result = summarizeRun({
      traceSpans: [
        {
          blockId: 'first',
          status: 'error',
          errorMessage: 'First failure',
          input: largeValue,
          output: largeValue,
        },
        {
          blockId: 'last',
          name: 'Last operation',
          status: 'error',
          errorMessage: 'Later failure',
          errorHandled: true,
        },
      ],
    })

    expect(result.failures).toMatchObject([
      { blockId: 'first', status: 'error', error: 'First failure', handled: false },
      {
        blockId: 'last',
        name: 'Last operation',
        status: 'error',
        error: 'Later failure',
        handled: true,
      },
    ])
    expect(result.truncated).toBe(true)
  })

  it('preserves a late failure after many successful observed spans', () => {
    const result = summarizeRun({
      traceSpans: [
        ...Array.from({ length: 99 }, (_, index) => ({
          blockId: `step-${index}`,
          name: `Step ${index}`,
          status: 'success',
        })),
        {
          blockId: 'last',
          name: 'Last operation',
          status: 'error',
          errorMessage: 'Late failure',
        },
      ],
    })

    expect(result.failures).toMatchObject([
      { blockId: 'last', name: 'Last operation', status: 'error', error: 'Late failure' },
    ])
    expect(result.observedBlocks).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it.each([false, true])(
    'retains legacy status-only tool failures with explicit handled=%s',
    (errorHandled) => {
      const result = summarizeRun({
        traceSpans: [
          {
            blockId: 'agent-1',
            status: 'success',
            errorHandled,
            toolCalls: [
              { name: 'lookup', status: 'error', input: { query: 'test' } },
              { name: 'lookup', status: 'success', output: { error: 'Ordinary data' } },
            ],
          },
        ],
      })

      expect(result.failures).toEqual([
        {
          blockId: 'agent-1',
          name: 'lookup',
          status: 'error',
          error: null,
          handled: errorHandled,
          input: { query: 'test' },
          output: null,
        },
      ])
      expect(result.truncated).toBe(false)
    }
  )

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

  it.each([
    { type: 'result', data: 'Customer notification delivered' },
    { name: 'result', data: 'Customer notification delivered' },
    { mimeType: 'unknown', data: 'Customer notification delivered' },
  ])('retains ordinary string data in labeled records: %j', (finalOutput) => {
    expect(summarizeRun({ status: 'completed', finalOutput })).toMatchObject({
      finalOutput,
      truncated: false,
    })
  })

  it.each([
    { mimeType: 'application/pdf', data: 'ENCODED_FILE_BYTES' },
    { name: 'test.pdf', type: 'application/pdf', data: 'ENCODED_FILE_BYTES' },
  ])('omits string file contents identified by MIME metadata: %j', (finalOutput) => {
    expect(summarizeRun({ finalOutput }).finalOutput).toEqual({
      ...finalOutput,
      data: '[binary omitted]',
    })
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
