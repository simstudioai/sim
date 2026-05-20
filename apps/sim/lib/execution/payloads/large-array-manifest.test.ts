/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  appendLargeArrayManifest,
  createLargeArrayManifest,
  isLargeArrayManifest,
  materializeLargeArrayManifest,
  readLargeArrayManifestSlice,
} from '@/lib/execution/payloads/large-array-manifest'
import { EXECUTION_RESOURCE_LIMIT_CODE } from '@/lib/execution/resource-errors'

const { mockDownloadFile, mockUploadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    downloadFile: mockDownloadFile,
    uploadFile: mockUploadFile,
  },
}))

const TEST_CONTEXT = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

describe('large array manifests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockDownloadFile.mockReset()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('creates a manifest with one chunk for the first page', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1 }, { id: 2 }], TEST_CONTEXT)

    expect(isLargeArrayManifest(manifest)).toBe(true)
    expect(manifest).toMatchObject({
      __simLargeArrayManifest: true,
      kind: 'array',
      totalCount: 2,
      chunkCount: 1,
      preview: [{ id: 1 }, { id: 2 }],
    })
    expect(manifest.chunks).toEqual([
      expect.objectContaining({ count: 2, byteSize: expect.any(Number) }),
    ])
    expect(mockUploadFile).toHaveBeenCalledTimes(1)
  })

  it('appends pages without materializing previous chunks', async () => {
    const firstPage = await createLargeArrayManifest([{ id: 1 }], TEST_CONTEXT)
    clearLargeValueCacheForTests()

    const manifest = await appendLargeArrayManifest(firstPage, [{ id: 2 }, { id: 3 }], TEST_CONTEXT)

    expect(manifest.totalCount).toBe(3)
    expect(manifest.chunkCount).toBe(2)
    expect(manifest.chunks).toHaveLength(2)
    expect(mockUploadFile).toHaveBeenCalledTimes(2)
  })

  it('reads a bounded slice from only requested positions', async () => {
    let manifest = await createLargeArrayManifest([{ id: 1 }, { id: 2 }], TEST_CONTEXT)
    manifest = await appendLargeArrayManifest(manifest, [{ id: 3 }, { id: 4 }], TEST_CONTEXT)

    await expect(readLargeArrayManifestSlice(manifest, 1, 2, TEST_CONTEXT)).resolves.toEqual([
      { id: 2 },
      { id: 3 },
    ])
  })

  it('splits oversized pages into bounded chunks', async () => {
    const manifest = await createLargeArrayManifest(
      [
        { id: 1, payload: 'x'.repeat(80) },
        { id: 2, payload: 'y'.repeat(80) },
        { id: 3, payload: 'z'.repeat(80) },
      ],
      { ...TEST_CONTEXT, chunkTargetBytes: 128 }
    )

    expect(manifest.totalCount).toBe(3)
    expect(manifest.chunkCount).toBe(3)
    expect(manifest.chunks.map((chunk) => chunk.count)).toEqual([1, 1, 1])
    expect(mockUploadFile).toHaveBeenCalledTimes(3)
  })

  it('chunks arrays with undefined entries using JSON array semantics', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1 }, undefined, { id: 3 }], {
      ...TEST_CONTEXT,
      chunkTargetBytes: 16,
    })

    expect(manifest.totalCount).toBe(3)
    await expect(readLargeArrayManifestSlice(manifest, 1, 1, TEST_CONTEXT)).resolves.toEqual([
      undefined,
    ])
  })

  it('reports non-serializable chunk values with a manifest-specific error', async () => {
    const circular: Record<string, unknown> = { id: 1 }
    circular.self = circular

    await expect(createLargeArrayManifest([circular], TEST_CONTEXT)).rejects.toThrow(
      'Large array manifest chunks must be JSON-serializable.'
    )
    await expect(createLargeArrayManifest([{ id: 1n }], TEST_CONTEXT)).rejects.toThrow(
      'Large array manifest chunks must be JSON-serializable.'
    )
  })

  it('skips preceding chunks without materializing them for bounded reads', async () => {
    let manifest = await createLargeArrayManifest([{ id: 1 }, { id: 2 }], TEST_CONTEXT)
    manifest = await appendLargeArrayManifest(manifest, [{ id: 3 }, { id: 4 }], TEST_CONTEXT)
    clearLargeValueCacheForTests()
    mockDownloadFile.mockImplementation(async ({ key }) => {
      expect(key).toBe(manifest.chunks[1].ref.key)
      return Buffer.from(JSON.stringify([{ id: 3 }, { id: 4 }]))
    })

    await expect(readLargeArrayManifestSlice(manifest, 2, 1, TEST_CONTEXT)).resolves.toEqual([
      { id: 3 },
    ])
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('bounds full materialization by byte size', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1, payload: 'x'.repeat(2048) }], {
      ...TEST_CONTEXT,
    })

    await expect(
      materializeLargeArrayManifest(manifest, { ...TEST_CONTEXT, maxBytes: 256 })
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
  })

  it('rejects manifests with understated aggregate byte size', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1, payload: 'x'.repeat(2048) }], {
      ...TEST_CONTEXT,
    })

    await expect(
      materializeLargeArrayManifest({ ...manifest, byteSize: 1 }, { ...TEST_CONTEXT })
    ).rejects.toThrow('Invalid large array manifest')
  })

  it('rejects manifests whose chunk count does not match materialized data', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1 }], TEST_CONTEXT)
    const forgedManifest = {
      ...manifest,
      totalCount: 2,
      chunks: [{ ...manifest.chunks[0], count: 2 }],
    }

    expect(isLargeArrayManifest(forgedManifest)).toBe(true)
    await expect(readLargeArrayManifestSlice(forgedManifest, 1, 1, TEST_CONTEXT)).rejects.toThrow(
      'Large array manifest chunk count does not match materialized data'
    )
  })

  it('does not serialize preview metadata during hot type-guard checks', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1 }], TEST_CONTEXT)
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    expect(
      isLargeArrayManifest({
        ...manifest,
        preview: [{ payload: 'x'.repeat(20 * 1024) }],
      })
    ).toBe(true)
    expect(stringifySpy).not.toHaveBeenCalled()
    stringifySpy.mockRestore()
  })
})
