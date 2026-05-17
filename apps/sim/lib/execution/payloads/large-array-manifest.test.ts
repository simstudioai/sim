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

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
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
    expect(manifest.chunks).toHaveLength(1)
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

  it('bounds full materialization by byte size', async () => {
    const manifest = await createLargeArrayManifest([{ id: 1, payload: 'x'.repeat(2048) }], {
      ...TEST_CONTEXT,
    })

    await expect(
      materializeLargeArrayManifest(manifest, { ...TEST_CONTEXT, maxBytes: 256 })
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
  })
})
