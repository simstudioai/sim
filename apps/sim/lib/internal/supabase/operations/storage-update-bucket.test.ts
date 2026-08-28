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

  it('sends only explicitly changed fields in one non-redirecting update request', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Successfully updated' }))

    await executeStorageUpdateBucketOperation({ ...INPUT, isPublic: true }, controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://projectref.supabase.co/storage/v1/bucket/documents',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ public: true }),
        redirect: 'error',
        signal: controller.signal,
      })
    )
  })

  it('treats whitespace-only file limits as omitted without reading the bucket', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Successfully updated' }))

    await executeStorageUpdateBucketOperation({
      ...INPUT,
      isPublic: false,
      fileSizeLimit: '   ' as never,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(payload).toEqual({ public: false })
  })

  it('rejects a nonnumeric file limit before updating the bucket', async () => {
    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: 'not-a-number' as never,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'File size limit must be a finite number',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([true, [], {}, '0x100'])('rejects a non-decimal file limit %j', async (fileSizeLimit) => {
    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: fileSizeLimit as never,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'File size limit must be a finite number',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves a no-op update while still verifying access to the bucket', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'documents' }))

    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      fileSizeLimit: '  ' as never,
    })

    expect(result).toEqual({
      success: true,
      output: {
        message: 'Successfully updated storage bucket',
        results: { message: 'Successfully updated' },
      },
      error: undefined,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://projectref.supabase.co/storage/v1/bucket/documents',
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    )
  })

  it('propagates cancellation instead of returning a failed tool envelope', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw (init?.signal as AbortSignal).reason
    })

    await expect(
      executeStorageUpdateBucketOperation({ ...INPUT, isPublic: true }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns a structured failure for an invalid project reference', async () => {
    const result = await executeStorageUpdateBucketOperation({
      ...INPUT,
      projectId: '../invalid',
    })

    expect(result).toMatchObject({
      success: false,
      output: { message: 'Failed to update storage bucket', results: {} },
      error: expect.any(String),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
