import { describe, expect, it } from 'vitest'
import { v2ExecutionErrorSchema } from '@/lib/api/contracts/v2/workflows'
import { HttpError } from '@/lib/core/utils/http-error'
import type { ExecutionResult } from '@/executor/types'
import {
  buildBlockExecutionError,
  classifyExecutionError,
  getExecutionErrorStatus,
  type WorkflowExecutionErrorCode,
} from '@/executor/utils/errors'
import type { SerializedBlock } from '@/serializer/types'

class TestRateLimitedError extends HttpError {
  readonly statusCode = 429
}

class TestUnavailableError extends HttpError {
  readonly statusCode = 503
}

class TestBadGatewayError extends HttpError {
  readonly statusCode = 502
}

const block = {
  id: 'block-1',
  position: { x: 0, y: 0 },
  config: { tool: 'test_tool', params: {} },
  inputs: {},
  outputs: {},
  metadata: { id: 'generic', name: 'My Block' },
  enabled: true,
} as SerializedBlock

describe('getExecutionErrorStatus', () => {
  it('forwards a 4xx from a typed HTTP error', () => {
    expect(getExecutionErrorStatus(new TestRateLimitedError('slow down'))).toBe(429)
  })

  it("forwards 503 because it describes Sim's own capacity", () => {
    expect(getExecutionErrorStatus(new TestUnavailableError('no keys'))).toBe(503)
  })

  it('does not forward an upstream 502 as the workflow API status', () => {
    expect(getExecutionErrorStatus(new TestBadGatewayError('upstream down'))).toBe(500)
  })

  it("never adopts an upstream target's duck-typed status as our own", () => {
    // `api-handler` copies the remote response's status onto the thrown error.
    // Adopting it would make a remote 404 the workflow API's 404.
    const error = Object.assign(new Error('HTTP 404'), { status: 404 })
    expect(getExecutionErrorStatus(error)).toBe(500)
  })

  it('still reads a Sim-owned statusCode re-attached from a ToolResponse', () => {
    const error = Object.assign(new Error('rate limited'), { statusCode: 429 })
    expect(getExecutionErrorStatus(error)).toBe(429)
  })

  it('finds a status carried further down the cause chain', () => {
    const wrapped = buildBlockExecutionError({
      block,
      error: new TestRateLimitedError('slow down'),
    })
    expect(getExecutionErrorStatus(wrapped)).toBe(429)
  })

  it('survives a cyclic cause chain', () => {
    const a = new Error('a')
    const b = new Error('b')
    Object.assign(a, { cause: b })
    Object.assign(b, { cause: a })
    expect(getExecutionErrorStatus(a)).toBe(500)
  })
})

describe('buildBlockExecutionError', () => {
  it('prefixes the block name and preserves the original as cause', () => {
    const original = new Error('inner failure')
    const wrapped = buildBlockExecutionError({ block, error: original })

    expect(wrapped.message).toBe('My Block: inner failure')
    expect(wrapped.cause).toBe(original)
  })
})

describe('hosted-key status survives the ToolResponse flattening', () => {
  /**
   * `executeTool` catches a thrown error and returns a `ToolResponse`, so the
   * status has to ride `ToolResponse.statusCode` and be re-attached by
   * `generic-handler`. This reproduces that hand-off end to end.
   */
  function errorFromFailedToolResponse(response: {
    error: string
    output: Record<string, unknown>
    statusCode?: number
  }): Error {
    const error = new Error(response.error)
    Object.assign(error, {
      output: response.output,
      ...(typeof response.statusCode === 'number' ? { statusCode: response.statusCode } : {}),
    })
    return buildBlockExecutionError({ block, error })
  }

  it('forwards a hosted-key 429 to the API caller', () => {
    const wrapped = errorFromFailedToolResponse({
      error: 'Rate limit exceeded',
      output: {},
      statusCode: 429,
    })
    expect(getExecutionErrorStatus(wrapped)).toBe(429)
  })

  it("never adopts an upstream provider's status as our own", () => {
    // A provider 404 rides `output`, never `statusCode`, so it must not surface.
    const wrapped = errorFromFailedToolResponse({
      error: 'HTTP 404: Not Found',
      output: { status: 404, statusText: 'Not Found' },
    })
    expect(getExecutionErrorStatus(wrapped)).toBe(500)
  })
})

describe('classifyExecutionError', () => {
  function failedResult(partial?: Partial<ExecutionResult>): ExecutionResult {
    return { success: false, output: {}, ...partial }
  }

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
