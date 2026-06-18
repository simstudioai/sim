/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveUploadError, uploadBufferToDrive } from '@/lib/google-drive/upload-to-drive'

function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number; statusText?: string }
) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const baseParams = {
  accessToken: 'token',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('data'),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('uploadBufferToDrive', () => {
  it('uploads and returns the created file metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'drive-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'drive-1', name: 'report.pdf', webViewLink: 'x' }))
    vi.stubGlobal('fetch', fetchMock)

    const file = await uploadBufferToDrive(baseParams)
    expect(file).toMatchObject({ id: 'drive-1', name: 'report.pdf', webViewLink: 'x' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws DriveUploadError when the multipart upload fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403, statusText: 'Forbidden' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadBufferToDrive(baseParams)).rejects.toMatchObject({
      name: 'DriveUploadError',
      status: 403,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws DriveUploadError when the final metadata fetch fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'drive-1' }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'busy' },
          { ok: false, status: 503, statusText: 'Service Unavailable' }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadBufferToDrive(baseParams)).rejects.toBeInstanceOf(DriveUploadError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
