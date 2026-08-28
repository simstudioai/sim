/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeStorageUpdateBucketOperation } from '@/lib/internal/supabase/operations/storage-update-bucket'

const INPUT = {
  apiKey: 'service-role-key',
  projectId: 'projectref',
  bucket: 'documents',
}

describe('executeStorageUpdateBucketOperation', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes cancellation to both bucket requests', async () => {
    const controller = new AbortController()
    fetchMock
      .mockResolvedValueOnce(Response.json({ public: false, file_size_limit: 100 }))
      .mockResolvedValueOnce(Response.json({ id: 'documents' }))

    await executeStorageUpdateBucketOperation({ ...INPUT, isPublic: true }, controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal: controller.signal })
  })

  it('treats whitespace-only file limits as omitted', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ public: false, file_size_limit: 4096 }))
      .mockResolvedValueOnce(Response.json({ id: 'documents' }))

    await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: '   ' as never,
    })

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(payload.file_size_limit).toBe(4096)
  })

  it('rejects a nonnumeric file limit before updating the bucket', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ public: false, file_size_limit: 4096 }))

    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: 'not-a-number' as never,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'File size limit must be a finite number',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([true, [], {}, '0x100'])('rejects a non-decimal file limit %j', async (fileSizeLimit) => {
    fetchMock.mockResolvedValueOnce(Response.json({ public: false, file_size_limit: 4096 }))

    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: fileSizeLimit as never,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'File size limit must be a finite number',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation instead of returning a failed tool envelope', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw (init?.signal as AbortSignal).reason
    })

    await expect(
      executeStorageUpdateBucketOperation(INPUT, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
