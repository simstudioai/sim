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
  it('still reads a report stored before a stubbed call recorded its MCP target and flags', () => {
    const stored = {
      topLevel: [],
      tests: [],
      sideEffects: {
        executions: {
          'exec-1': {
            stubbed: [{ workflowId: 'wf', blockId: 'b', block: 'Send', tool: 'slack', count: 1 }],
            unchecked: [],
            omitted: { stubbed: 0, unchecked: 0 },
          },
        },
        omittedExecutions: 0,
      },
    }

    const parsed = storedTestReportSchema.parse(stored)

    expect(parsed.sideEffects?.executions['exec-1'].stubbed).toEqual([
      {
        workflowId: 'wf',
        blockId: 'b',
        block: 'Send',
        tool: 'slack',
        mcp: null,
        dependsOnStub: false,
        readOnlyHint: false,
        count: 1,
      },
    ])
  })
})
