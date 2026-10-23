import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
