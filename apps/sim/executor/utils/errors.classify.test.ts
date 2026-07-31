/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ExecutionResult } from '@/executor/types'
import {
  attachExecutionResult,
  buildBlockExecutionError,
  classifyExecutionError,
} from '@/executor/utils/errors'

function failedResult(partial?: Partial<ExecutionResult>): ExecutionResult {
  return { success: false, output: {}, ...partial }
}

describe('classifyExecutionError', () => {
  it('reads block context from the fields buildBlockExecutionError attaches and strips the name prefix', () => {
    const error = buildBlockExecutionError({
      block: { id: 'block-1', metadata: { name: 'Send Email', id: 'gmail' } } as never,
      error: new Error('Invalid credentials'),
    })

    const classified = classifyExecutionError(error)

    expect(classified).toMatchObject({
      message: 'Invalid credentials',
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'block-1',
      blockName: 'Send Email',
      blockType: 'gmail',
    })
  })

  it('falls back to the last failed, un-handled block log', () => {
    const result = failedResult({
      error: 'Agent: model refused',
      logs: [
        {
          blockId: 'b-ok',
          blockName: 'First',
          blockType: 'function',
          success: true,
          startedAt: '',
          endedAt: '',
          durationMs: 1,
        },
        {
          blockId: 'b-handled',
          blockName: 'Handled',
          blockType: 'api',
          success: false,
          errorHandled: true,
          error: 'handled upstream',
          startedAt: '',
          endedAt: '',
          durationMs: 1,
        },
        {
          blockId: 'b-fail',
          blockName: 'Agent',
          blockType: 'agent',
          success: false,
          error: 'model refused',
          startedAt: '',
          endedAt: '',
          durationMs: 1,
        },
      ],
    })

    const classified = classifyExecutionError(new Error('Agent: model refused'), result)

    expect(classified).toMatchObject({
      message: 'model refused',
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'b-fail',
      blockName: 'Agent',
      blockType: 'agent',
    })
  })

  it('classifies child-workflow failures so parents can route on error class', () => {
    const result = failedResult({
      logs: [
        {
          blockId: 'wf-block',
          blockName: 'Enrich Lead',
          blockType: 'workflow_input',
          success: false,
          error: 'Child workflow failed',
          startedAt: '',
          endedAt: '',
          durationMs: 1,
        },
      ],
    })

    expect(classifyExecutionError(new Error('Child workflow failed'), result).code).toBe(
      'CHILD_WORKFLOW_FAILED'
    )
  })

  it('maps the attached 4xx statusCode families', () => {
    const timeoutError = new Error('Execution exceeded the time limit')
    Object.assign(timeoutError, { statusCode: 408 })
    expect(classifyExecutionError(timeoutError).code).toBe('TIMEOUT')

    const usageError = new Error('Usage limit exceeded for this billing period')
    Object.assign(usageError, { statusCode: 402 })
    expect(classifyExecutionError(usageError).code).toBe('USAGE_LIMIT_EXCEEDED')
  })

  it('uses the attached executionResult when none is passed explicitly', () => {
    const error = new Error('Slack: channel not found')
    attachExecutionResult(
      error,
      failedResult({
        logs: [
          {
            blockId: 'slack-1',
            blockName: 'Slack',
            blockType: 'slack',
            success: false,
            error: 'channel not found',
            startedAt: '',
            endedAt: '',
            durationMs: 1,
          },
        ],
      })
    )

    expect(classifyExecutionError(error)).toMatchObject({
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'slack-1',
      message: 'channel not found',
    })
  })

  it('falls back to EXECUTION_FAILED with the raw message when nothing is classifiable', () => {
    expect(classifyExecutionError(new Error('something odd'))).toEqual({
      message: 'something odd',
      code: 'EXECUTION_FAILED',
      blockId: undefined,
      blockName: undefined,
      blockType: undefined,
    })
  })
})
