import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  MAX_DURABLE_LARGE_VALUE_BYTES,
  MAX_TRACE_ARCHIVE_BYTES,
} from '@/lib/execution/payloads/limits'
import { storeLargeValue } from '@/lib/execution/payloads/store'
import { EXECUTION_RESOURCE_LIMIT_CODE } from '@/lib/execution/resource-errors'
import {
  externalizeExecutionData,
  materializeExecutionData,
  TRACE_STORE_REF_KEY,
} from '@/lib/logs/execution/trace-store'

const { mockUploadFile, mockDownloadFile, mockRegisterOwner, mockAddReference } = vi.hoisted(
  () => ({
    mockUploadFile: vi.fn(),
    mockDownloadFile: vi.fn(),
    mockRegisterOwner: vi.fn(),
    mockAddReference: vi.fn(),
  })
)

/** Scale the two caps down to exercise real serialization and storage reads with small fixtures. */
vi.mock('@/lib/execution/payloads/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/payloads/limits')>()),
  MAX_DURABLE_LARGE_VALUE_BYTES: 1024,
  MAX_TRACE_ARCHIVE_BYTES: 4096,
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mockUploadFile, downloadFile: mockDownloadFile },
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  registerLargeValueOwner: mockRegisterOwner,
  addLargeValueReference: mockAddReference,
}))

const CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

beforeEach(() => {
  clearLargeValueCacheForTests()
  mockRegisterOwner.mockResolvedValue(true)
  mockUploadFile.mockImplementation(async ({ customKey, file }) => {
    mockDownloadFile.mockResolvedValue(file)
    return { key: customKey }
  })
})

describe('trace archive storage round trip', () => {
  it('uploads an archive above the ordinary value cap and reads it back after a cache miss', async () => {
    const data = {
      traceSpans: [{ id: 'span-1', output: 'é'.repeat(MAX_DURABLE_LARGE_VALUE_BYTES) }],
      traceSpanCount: 1,
      hasTraceSpans: true,
      hasHandledErrors: false,
    }
    const json = JSON.stringify(data)
    const size = Buffer.byteLength(json, 'utf8')
    expect(size).toBeGreaterThan(MAX_DURABLE_LARGE_VALUE_BYTES)
    expect(size).toBeLessThan(MAX_TRACE_ARCHIVE_BYTES)

    await expect(storeLargeValue(data, json, size, CONTEXT)).rejects.toMatchObject({
      code: EXECUTION_RESOURCE_LIMIT_CODE,
    })
    expect(mockUploadFile).not.toHaveBeenCalled()

    const slim = await externalizeExecutionData(data, CONTEXT, { throwOnError: true })
    expect(slim).toEqual({
      [TRACE_STORE_REF_KEY]: expect.objectContaining({ size, key: expect.any(String) }),
      traceSpanCount: 1,
      hasTraceSpans: true,
      hasHandledErrors: false,
    })
    expect(mockRegisterOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: CONTEXT.workspaceId,
        workflowId: CONTEXT.workflowId,
        executionId: CONTEXT.executionId,
        size,
      }),
      []
    )
    clearLargeValueCacheForTests()

    await expect(materializeExecutionData(slim, CONTEXT)).resolves.toEqual(data)
    expect(mockDownloadFile).toHaveBeenCalledExactlyOnceWith({
      key: expect.any(String),
      context: 'execution',
      maxBytes: size,
    })
    expect(mockAddReference).not.toHaveBeenCalled()
  })

  it('rejects an over-limit archive before uploading it', async () => {
    await expect(
      externalizeExecutionData(
        { traceSpans: [{ output: 'x'.repeat(MAX_TRACE_ARCHIVE_BYTES) }] },
        CONTEXT,
        { throwOnError: true }
      )
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(mockRegisterOwner).not.toHaveBeenCalled()
  })

  it('bounds stored archive reads even if a reference declares a larger size', async () => {
    const data = { traceSpans: [], hasTraceSpans: false }
    const slim = await externalizeExecutionData(data, CONTEXT, { throwOnError: true })
    clearLargeValueCacheForTests()

    await expect(
      materializeExecutionData(
        {
          ...slim,
          [TRACE_STORE_REF_KEY]: {
            ...(slim[TRACE_STORE_REF_KEY] as Record<string, unknown>),
            size: MAX_TRACE_ARCHIVE_BYTES + 1,
          },
        },
        CONTEXT
      )
    ).resolves.toEqual({ hasTraceSpans: false, hasHandledErrors: false })
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })
})
