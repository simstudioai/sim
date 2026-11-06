import { describe, expect, it } from 'vitest'
import { testReplyArgsSchema } from '@/lib/workflow-tests/protocol'

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
