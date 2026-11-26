import { describe, expect, it } from 'vitest'
import { storedTestReportSchema, testReplyArgsSchema } from '@/lib/workflow-tests/protocol'

describe('testReplyArgsSchema', () => {
  it('keeps the error of a mock that threw', () => {
    // The sandbox sends no `output` key for a thrown mock; an optional `output` must not claim it.
    expect(
      testReplyArgsSchema.parse({ runId: 'r', callId: 'c', error: '409 version conflict' })
    ).toEqual({
      runId: 'r',
      callId: 'c',
      error: '409 version conflict',
    })
  })

  it('never reads an error past the cap as an empty output', () => {
    const reply = { runId: 'r', callId: 'c', error: 'x'.repeat(10_001) }
    expect(testReplyArgsSchema.safeParse(reply).success).toBe(false)
  })
})

describe('storedTestReportSchema', () => {
  const stored = (stubbed: Array<Record<string, unknown>>) => ({
    topLevel: [],
    tests: [],
    sideEffects: {
      executions: {
        'exec-1': { stubbed, unchecked: [], omitted: { stubbed: 0, unchecked: 0 } },
      },
      omittedExecutions: 0,
    },
  })
  const call = { workflowId: 'wf', blockId: 'b', block: 'Send', tool: 'slack', count: 1 }

  it('still reads a report stored before a stubbed call recorded its MCP target or reason', () => {
    const parsed = storedTestReportSchema.parse(stored([call]))

    expect(parsed.sideEffects?.executions['exec-1'].stubbed).toEqual([{ ...call, mcp: null }])
  })

  it('reads the reason a report stored as flags, before it was named', () => {
    const parsed = storedTestReportSchema.parse(
      stored([
        { ...call, dependsOnStub: true, readOnlyHint: true },
        { ...call, dependsOnStub: false, readOnlyHint: true },
        { ...call, dependsOnStub: false, readOnlyHint: false },
        { ...call, reason: 'placeholder' },
      ])
    )

    expect(parsed.sideEffects?.executions['exec-1'].stubbed).toEqual([
      { ...call, mcp: null, reason: 'placeholder' },
      { ...call, mcp: null, reason: 'mcp-read-only' },
      { ...call, mcp: null },
      { ...call, mcp: null, reason: 'placeholder' },
    ])
  })
})
