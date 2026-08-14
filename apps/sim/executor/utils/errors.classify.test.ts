/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2ExecutionErrorSchema } from '@/lib/api/contracts/v2/workflows'
import type { ExecutionResult } from '@/executor/types'
import {
  attachExecutionResult,
  buildBlockExecutionError,
  classifyExecutionError,
  type WorkflowExecutionErrorCode,
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

  /**
   * The published enum promises callers a code to route on, so a member this
   * function cannot produce is a branch no response ever takes — the state
   * `OUTPUT_TOO_LARGE` was in until it was retired, since an oversize run
   * response is an HTTP 413 and never reaches classification. Pinning the two
   * together makes the next unreachable member fail here instead of shipping
   * into SDK types.
   */
  it('produces every code the public execution-error contract publishes', () => {
    const producedBy: Record<WorkflowExecutionErrorCode, unknown> = {
      TIMEOUT: new Error('Execution timed out after 5 minutes'),
      CANCELLED: new Error('Run was cancelled'),
      USAGE_LIMIT_EXCEEDED: new Error('Usage limit exceeded for this billing period'),
      INVALID_INPUT: new Error('Invalid input format for the workflow'),
      BLOCK_EXECUTION_FAILED: buildBlockExecutionError({
        block: { id: 'block-1', metadata: { name: 'Send Email', id: 'gmail' } } as never,
        error: new Error('Invalid credentials'),
      }),
      CHILD_WORKFLOW_FAILED: buildBlockExecutionError({
        block: { id: 'block-2', metadata: { name: 'Child', id: 'workflow' } } as never,
        error: new Error('Child run failed'),
      }),
      EXECUTION_FAILED: new Error('something odd'),
    }

    for (const [code, error] of Object.entries(producedBy)) {
      expect(classifyExecutionError(error).code).toBe(code)
    }
    expect(new Set(v2ExecutionErrorSchema.shape.code.options)).toEqual(
      new Set(Object.keys(producedBy))
    )
  })
})
