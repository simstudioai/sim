/**
 * Tests that internal JWT callers receive the standard response format
 * even when the child workflow has a Response block.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { createLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { storeLargeValue } from '@/lib/execution/payloads/store'
import { EXECUTION_RESOURCE_LIMIT_CODE } from '@/lib/execution/resource-errors'
import type { ExecutionResult } from '@/lib/workflows/types'
import { createHttpResponseFromBlock, workflowHasResponseBlock } from '@/lib/workflows/utils'

const {
  mockAddLargeValueReference,
  mockDownloadFile,
  mockRegisterLargeValueOwner,
  mockUploadFile,
  uploadedFiles,
} = vi.hoisted(() => ({
  mockAddLargeValueReference: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockRegisterLargeValueOwner: vi.fn(),
  mockUploadFile: vi.fn(),
  uploadedFiles: new Map<string, Buffer>(),
}))

const MATERIALIZATION_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    downloadFile: mockDownloadFile,
    uploadFile: mockUploadFile,
  },
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  addLargeValueReference: mockAddLargeValueReference,
  registerLargeValueOwner: mockRegisterLargeValueOwner,
}))

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
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    uploadedFiles.clear()
    mockAddLargeValueReference.mockResolvedValue(undefined)
    mockRegisterLargeValueOwner.mockResolvedValue(true)
    mockUploadFile.mockImplementation(async ({ customKey, file }) => {
      uploadedFiles.set(customKey, file)
      return { key: customKey }
    })
    mockDownloadFile.mockImplementation(
      async ({ key }) => uploadedFiles.get(key) ?? Buffer.from('{}')
    )
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

  it('should apply Response block formatting for API key callers', async () => {
    const authType = AuthType.API_KEY
    const hasResponseBlock = workflowHasResponseBlock(resultWithResponseBlock)

    const shouldFormatAsResponseBlock = authType !== AuthType.INTERNAL_JWT && hasResponseBlock
    expect(shouldFormatAsResponseBlock).toBe(true)

    const response = await createHttpResponseFromBlock(resultWithResponseBlock)
    expect(response.status).toBe(200)
  })

  it('should apply Response block formatting for session callers', () => {
    const authType = AuthType.SESSION
    const hasResponseBlock = workflowHasResponseBlock(resultWithResponseBlock)

    const shouldFormatAsResponseBlock = authType !== AuthType.INTERNAL_JWT && hasResponseBlock
    expect(shouldFormatAsResponseBlock).toBe(true)
  })

  it('should return raw user data via createHttpResponseFromBlock', async () => {
    const response = await createHttpResponseFromBlock(resultWithResponseBlock)
    const body = await response.json()

    // Response block returns the user-defined data directly (no success/executionId wrapper)
    expect(body).toEqual({ issues: [] })
    expect(body.success).toBeUndefined()
    expect(body.executionId).toBeUndefined()
  })

  it('should respect custom status codes from Response block', async () => {
    const result = buildExecutionResult({
      output: { data: { error: 'Not found' }, status: 404, headers: {} },
    })

    const response = await createHttpResponseFromBlock(result)
    expect(response.status).toBe(404)
  })

  it('should materialize manifest data for Response block HTTP output', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      key: `SIM-${index}`,
      payload: 'x'.repeat(100),
    }))
    const output = await compactExecutionPayload(
      {
        data: { rows },
        status: 200,
        headers: {},
      },
      {
        ...MATERIALIZATION_CONTEXT,
        requireDurable: true,
        preserveRoot: true,
        thresholdBytes: 1024,
      }
    )
    const response = await createHttpResponseFromBlock(
      buildExecutionResult({ output }),
      MATERIALIZATION_CONTEXT
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.rows).toEqual(rows)
    expect(body.success).toBeUndefined()
  })

  it('should materialize Response block manifests from an allowed source execution', async () => {
    const rows = [{ key: 'SIM-1' }, { key: 'SIM-2' }]
    const manifest = await createLargeArrayManifest(rows, {
      ...MATERIALIZATION_CONTEXT,
      executionId: 'source-execution-1',
    })

    const response = await createHttpResponseFromBlock(
      buildExecutionResult({
        output: {
          data: { rows: manifest },
          status: 200,
          headers: {},
        },
      }),
      {
        ...MATERIALIZATION_CONTEXT,
        largeValueExecutionIds: ['source-execution-1'],
      }
    )
    const body = await response.json()

    expect(body.rows).toEqual(rows)
  })

  it('should reject Response block manifests from non-source same-workflow executions', async () => {
    const manifest = await createLargeArrayManifest([{ key: 'SIM-stale' }], {
      ...MATERIALIZATION_CONTEXT,
      executionId: 'stale-execution-1',
    })

    await expect(
      createHttpResponseFromBlock(
        buildExecutionResult({
          output: {
            data: { rows: manifest },
            status: 200,
            headers: {},
          },
        }),
        {
          ...MATERIALIZATION_CONTEXT,
          largeValueExecutionIds: ['source-execution-1'],
        }
      )
    ).rejects.toThrow('Large execution value is not available in this execution')
  })

  it('should materialize Response block manifests inherited by the source snapshot', async () => {
    const rows = [{ key: 'SIM-inherited' }]
    const manifest = await createLargeArrayManifest(rows, {
      ...MATERIALIZATION_CONTEXT,
      executionId: 'original-execution-1',
    })

    const response = await createHttpResponseFromBlock(
      buildExecutionResult({
        output: {
          data: { rows: manifest },
          status: 200,
          headers: {},
        },
      }),
      {
        ...MATERIALIZATION_CONTEXT,
        largeValueExecutionIds: ['source-execution-1', 'original-execution-1'],
      }
    )

    const body = await response.json()

    expect(body.rows).toEqual(rows)
  })

  it('should recursively materialize refs inside Response block manifest rows', async () => {
    const text = 'nested'.repeat(2 * 1024 * 1024)
    const nestedOutput = await compactExecutionPayload(
      { text },
      {
        ...MATERIALIZATION_CONTEXT,
        executionId: 'original-execution-1',
        requireDurable: true,
        preserveRoot: true,
      }
    )
    const nestedRef = (nestedOutput as unknown as { text: unknown }).text
    const manifest = await createLargeArrayManifest([{ nested: nestedRef }], {
      ...MATERIALIZATION_CONTEXT,
      executionId: 'source-execution-1',
    })
    const response = await createHttpResponseFromBlock(
      buildExecutionResult({
        output: {
          data: { rows: manifest },
          status: 200,
          headers: {},
        },
      }),
      {
        ...MATERIALIZATION_CONTEXT,
        largeValueExecutionIds: ['source-execution-1'],
      }
    )

    const body = await response.json()

    expect(body.rows).toEqual([{ nested: text }])
  })

  it('should recursively materialize refs inside stored Response block objects', async () => {
    const text = 'nested'.repeat(2 * 1024 * 1024)
    const nestedOutput = await compactExecutionPayload(
      { text },
      {
        ...MATERIALIZATION_CONTEXT,
        executionId: 'original-execution-1',
        requireDurable: true,
        preserveRoot: true,
      }
    )
    const nestedRef = (nestedOutput as unknown as { text: unknown }).text
    const storedValue = {
      wrapper: {
        nested: nestedRef,
        padding: 'x'.repeat(2048),
      },
    }
    const storedJson = JSON.stringify(storedValue)
    const storedOutput = await storeLargeValue(
      storedValue,
      storedJson,
      Buffer.byteLength(storedJson),
      {
        ...MATERIALIZATION_CONTEXT,
        executionId: 'source-execution-1',
        requireDurable: true,
      }
    )

    const response = await createHttpResponseFromBlock(
      buildExecutionResult({
        output: {
          data: storedOutput,
          status: 200,
          headers: {},
        },
      }),
      {
        ...MATERIALIZATION_CONTEXT,
        largeValueExecutionIds: ['source-execution-1'],
      }
    )

    const body = await response.json()

    expect(body.wrapper.nested).toEqual(text)
  })

  it('should memoize repeated materialized objects while resolving nested refs', async () => {
    const text = 'nested'.repeat(2 * 1024 * 1024)
    const nestedOutput = await compactExecutionPayload(
      { text },
      {
        ...MATERIALIZATION_CONTEXT,
        executionId: 'original-execution-1',
        requireDurable: true,
        preserveRoot: true,
      }
    )
    const nestedRef = (nestedOutput as unknown as { text: unknown }).text
    const sourceValue = { nested: nestedRef }
    const sourceJson = JSON.stringify(sourceValue)
    const sourceRef = await storeLargeValue(
      sourceValue,
      sourceJson,
      Buffer.byteLength(sourceJson),
      {
        ...MATERIALIZATION_CONTEXT,
        executionId: 'source-execution-1',
        requireDurable: true,
      }
    )

    const response = await createHttpResponseFromBlock(
      buildExecutionResult({
        output: {
          data: { first: sourceRef, second: sourceRef },
          status: 200,
          headers: {},
        },
      }),
      {
        ...MATERIALIZATION_CONTEXT,
        largeValueKeys: sourceRef.key ? [sourceRef.key] : [],
      }
    )

    const body = await response.json()

    expect(body).toEqual({
      first: { nested: text },
      second: { nested: text },
    })
  })

  it('should materialize large string refs for Response block HTTP output', async () => {
    const text = 'x'.repeat(9 * 1024 * 1024)
    const output = await compactExecutionPayload(
      {
        data: { text },
        status: 200,
        headers: {},
      },
      {
        ...MATERIALIZATION_CONTEXT,
        requireDurable: true,
        preserveRoot: true,
      }
    )
    const response = await createHttpResponseFromBlock(
      buildExecutionResult({ output }),
      MATERIALIZATION_CONTEXT
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.text).toBe(text)
  })

  it('should reject Response block HTTP output that is too large to inline', async () => {
    const output = await compactExecutionPayload(
      {
        data: {
          text: 'x'.repeat(17 * 1024 * 1024),
        },
        status: 200,
        headers: {},
      },
      {
        ...MATERIALIZATION_CONTEXT,
        requireDurable: true,
        preserveRoot: true,
      }
    )

    await expect(
      createHttpResponseFromBlock(buildExecutionResult({ output }), MATERIALIZATION_CONTEXT)
    ).rejects.toMatchObject({
      code: EXECUTION_RESOURCE_LIMIT_CODE,
    })
  })
})
