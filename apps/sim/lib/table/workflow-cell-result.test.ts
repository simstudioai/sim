/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { classifyWorkflowCellTerminalResult } from '@/lib/table/workflow-cell-result'

describe('classifyWorkflowCellTerminalResult', () => {
  it('preserves a non-timeout cancellation as cancelled', () => {
    expect(
      classifyWorkflowCellTerminalResult(
        { success: false, status: 'cancelled' },
        { timedOut: false }
      )
    ).toEqual({ status: 'cancelled', error: 'Cancelled' })
  })

  it('classifies a deadline cancellation as an error', () => {
    expect(
      classifyWorkflowCellTerminalResult(
        { success: false, status: 'cancelled' },
        { timedOut: true, timeoutMs: 5_000 }
      )
    ).toEqual({ status: 'error', error: 'Execution timed out after 5 seconds' })
  })

  it('preserves completed and failed outcomes', () => {
    expect(
      classifyWorkflowCellTerminalResult(
        { success: true, status: 'completed' },
        { timedOut: false }
      )
    ).toEqual({ status: 'completed', error: null })
    expect(
      classifyWorkflowCellTerminalResult(
        { success: false, status: 'error', error: 'Block failed' },
        { timedOut: false }
      )
    ).toEqual({ status: 'error', error: 'Block failed' })
  })
})
