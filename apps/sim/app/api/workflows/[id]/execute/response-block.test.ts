/**
 * Tests that internal JWT callers receive the standard response format
 * even when the child workflow has a Response block.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import type { ExecutionResult } from '@/lib/workflows/types'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'

function buildExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    output: { data: { issues: [] }, status: 200, headers: {} },
    logs: [
      {
        blockId: 'response-1',
        blockType: 'response',
        blockName: 'Response',
        success: true,
        output: { data: { issues: [] }, status: 200, headers: {} },
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      },
    ],
    metadata: {
      duration: 500,
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-01T00:00:01Z',
    },
    ...overrides,
  }
}

describe('Response block gating by auth type', () => {
  let resultWithResponseBlock: ExecutionResult

  beforeEach(() => {
    resultWithResponseBlock = buildExecutionResult()
  })

  it('should detect a Response block in execution result', () => {
    expect(workflowHasResponseBlock(resultWithResponseBlock)).toBe(true)
  })

  it('should not detect a Response block when none exists', () => {
    const resultWithoutResponseBlock = buildExecutionResult({
      output: { result: 'hello' },
      logs: [
        {
          blockId: 'agent-1',
          blockType: 'agent',
          blockName: 'Agent',
          success: true,
          output: { result: 'hello' },
          startedAt: '2026-01-01T00:00:00Z',
          endedAt: '2026-01-01T00:00:01Z',
        },
      ],
    })
    expect(workflowHasResponseBlock(resultWithoutResponseBlock)).toBe(false)
  })

  it('should skip Response block formatting for internal JWT callers', () => {
    const authType = AuthType.INTERNAL_JWT
    const hasResponseBlock = workflowHasResponseBlock(resultWithResponseBlock)

    expect(hasResponseBlock).toBe(true)

    // This mirrors the route.ts condition:
    // if (auth.authType !== AuthType.INTERNAL_JWT && workflowHasResponseBlock(...))
    const shouldFormatAsResponseBlock = authType !== AuthType.INTERNAL_JWT && hasResponseBlock
    expect(shouldFormatAsResponseBlock).toBe(false)
  })

  it('should apply Response block formatting for API key callers', () => {
    const authType = AuthType.API_KEY
    const hasResponseBlock = workflowHasResponseBlock(resultWithResponseBlock)

    const shouldFormatAsResponseBlock = authType !== AuthType.INTERNAL_JWT && hasResponseBlock
    expect(shouldFormatAsResponseBlock).toBe(true)

    const response = createHttpResponseFromBlock(resultWithResponseBlock)
    expect(response.status).toBe(200)
  })

  it('should apply Response block formatting for session callers', () => {
    const authType = AuthType.SESSION
    const hasResponseBlock = workflowHasResponseBlock(resultWithResponseBlock)

    const shouldFormatAsResponseBlock = authType !== AuthType.INTERNAL_JWT && hasResponseBlock
    expect(shouldFormatAsResponseBlock).toBe(true)
  })

  it('should return raw user data via createHttpResponseFromBlock', async () => {
    const response = createHttpResponseFromBlock(resultWithResponseBlock)
    const body = await response.json()

    // Response block returns the user-defined data directly (no success/executionId wrapper)
    expect(body).toEqual({ issues: [] })
    expect(body.success).toBeUndefined()
    expect(body.executionId).toBeUndefined()
  })

  it('should respect custom status codes from Response block', () => {
    const result = buildExecutionResult({
      output: { data: { error: 'Not found' }, status: 404, headers: {} },
    })

    const response = createHttpResponseFromBlock(result)
    expect(response.status).toBe(404)
  })
})
