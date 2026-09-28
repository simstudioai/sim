/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { classifyWorkflowJobFailure } from '@/lib/workflows/executor/job-failure'
import { buildBlockExecutionError } from '@/executor/utils/errors'
import { WorkflowValidationError } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'

const block = {
  id: 'block-1',
  metadata: { id: 'function', name: 'planPanels' },
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
  it('treats a block failure that core finalizes after throwing as the workflow outcome', async () => {
    const error = buildBlockExecutionError({ block, error: new Error("ValueError: kind ''") })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-1',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('workflow_failure')
  })

  it('treats a pre-execution validation failure on a block as the workflow outcome', async () => {
    const error = new WorkflowValidationError(
      'Gmail 2 is missing required fields: Label',
      'block-2',
      'gmail',
      'Gmail 2'
    )

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-2',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('workflow_failure')
  })

  it('faults a block failure core could not record', async () => {
    const error = buildBlockExecutionError({ block, error: new Error('boom') })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-3',
        loggingSession: sessionFinalizing(error, false),
      })
    ).resolves.toBe('job_fault')
  })

  it('faults an engine failure that no block owns even when core recorded it', async () => {
    const error = new Error('Cannot read properties of undefined (reading "edges")')

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-4',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('job_fault')
  })
})

describe('classifyWorkflowJobFailure for failures in Sim code', () => {
  it('faults a block failure caused by a programming error in Sim code', async () => {
    const error = buildBlockExecutionError({
      block,
      error: new TypeError('rows.flatMap is not a function'),
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-5',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('job_fault')
  })

  it('faults a block failure a tool flattened from a system error', async () => {
    const error = Object.assign(new Error('writeLibraryRows: rows.flatMap is not a function'), {
      blockId: 'write-library-rows',
      blockName: 'writeLibraryRows',
      blockType: 'table',
      isSystemError: true,
    })

    await expect(
      classifyWorkflowJobFailure({
        error,
        executionId: 'execution-6',
        loggingSession: sessionFinalizing(error, true),
      })
    ).resolves.toBe('job_fault')
  })
})
