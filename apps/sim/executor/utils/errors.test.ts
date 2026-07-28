/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { HttpError } from '@/lib/core/utils/http-error'
import { buildBlockExecutionError, getExecutionErrorStatus } from '@/executor/utils/errors'
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

  it('falls back to 500 for an untyped error', () => {
    expect(getExecutionErrorStatus(new Error('boom'))).toBe(500)
  })

  it('reads the legacy duck-typed status field', () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 })
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

  it('leaves cause unset for a non-Error throw', () => {
    const wrapped = buildBlockExecutionError({ block, error: 'plain string' })

    expect(wrapped.message).toBe('My Block: plain string')
    expect(wrapped.cause).toBeUndefined()
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

  it('forwards a hosted-key 503 to the API caller', () => {
    const wrapped = errorFromFailedToolResponse({
      error: 'No hosted keys configured',
      output: {},
      statusCode: 503,
    })
    expect(getExecutionErrorStatus(wrapped)).toBe(503)
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
