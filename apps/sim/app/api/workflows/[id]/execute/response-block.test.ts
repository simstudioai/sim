/**
 * Tests that internal JWT callers receive the standard response format
 * even when the child workflow has a Response block.
 */

import {
  largeValueMetadataMock,
  largeValueMetadataMockFns,
} from '@sim/testing/mocks/large-value-metadata.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { createLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { EXECUTION_RESOURCE_LIMIT_CODE } from '@/lib/execution/resource-errors'
import type { ExecutionResult } from '@/lib/workflows/types'
import { createHttpResponseFromBlock } from '@/lib/workflows/utils'

const { mockAddLargeValueReference, mockRegisterLargeValueOwner } = largeValueMetadataMockFns
const { mockDownloadFile, mockUploadFile } = storageServiceMockFns
const uploadedFiles = new Map<string, Buffer>()

const MATERIALIZATION_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/execution/payloads/large-value-metadata', () => largeValueMetadataMock)

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
  beforeEach(() => {
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
