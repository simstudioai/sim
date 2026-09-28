/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { classifyWorkflowJobFailure } from '@/lib/workflows/executor/job-failure'
import { buildBlockExecutionError, markWorkflowUserFailure } from '@/executor/utils/errors'
import type { SerializedBlock } from '@/serializer/types'

const planPanels = {
  id: 'plan-panels',
  metadata: { id: 'function', name: 'planPanels' },
} as SerializedBlock

const writeLedger = {
  id: 'write-ledger',
  metadata: { id: 'table', name: 'writeLedger' },
} as SerializedBlock

/**
 * Core throws first and finalizes the execution log from a post-execution
 * promise; this session resolves that promise the way core does, by flagging
 * the thrown error once the log write lands.
 */
function sessionFinalizing(error: Error, finalized: boolean) {
  return {
    waitForPostExecution: async () => {
      if (finalized) Object.assign(error, { executionFinalizedByCore: true })
    },
  }
}

describe('classifyWorkflowJobFailure', () => {
  it('treats a marked failure that core records only after throwing as the workflow outcome', async () => {
    const error = buildBlockExecutionError({
      block: planPanels,
      error: markWorkflowUserFailure(new Error("ValueError: kind ''")),
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-1',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('workflow_failure')
  })

  it('treats a marked failure inside a child workflow as the workflow outcome', async () => {
    const childFailure = buildBlockExecutionError({
      block: planPanels,
      error: markWorkflowUserFailure(new Error("KeyError: 'id'")),
    })
    const error = new Error(`callSheets: "sheets" failed: ${childFailure.message}`, {
      cause: childFailure,
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-2',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('workflow_failure')
  })

  it('faults a marked failure core could not record', async () => {
    const error = buildBlockExecutionError({
      block: planPanels,
      error: markWorkflowUserFailure(new Error("ValueError: kind ''")),
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-3',
        loggingSession: sessionFinalizing(error, false),
      })
    ).resolves.toBe('job_fault')
  })

  it('faults an unmarked failure inside a block even when core recorded it', async () => {
    const error = buildBlockExecutionError({
      block: writeLedger,
      error: new Error('An internal error occurred while running this block'),
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-4',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('job_fault')
  })
})
