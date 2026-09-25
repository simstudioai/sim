import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
}))

import { executeSquareCreateCatalogImage } from '@/lib/internal/square/operations'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/image.png',
  name: 'image.png',
  size: 4,
  type: 'image/png',
  url: '/api/files/serve?key=image.png',
}

describe('executeSquareCreateCatalogImage', () => {
  beforeEach(() => {
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from('image'))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ image: { id: 'image-1', type: 'IMAGE', version: 1 } }))
    )
  })

  it('authorizes, loads, and uploads the file once with the supplied idempotency key', async () => {
    const response = await executeSquareCreateCatalogImage(
      {
        accessToken: 'square-token',
        file: FILE,
        fileName: null,
        objectId: 'item-1',
        caption: 'Product',
        idempotencyKey: 'stable-key',
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: { metadata: { id: 'image-1', type: 'IMAGE', version: 1 } },
    })
    expect(mocks.assertToolFileAccess).toHaveBeenCalledOnce()
    expect(mocks.downloadFileFromStorage).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    const formData = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(JSON.parse(String(formData.get('request')))).toMatchObject({
      idempotency_key: 'stable-key',
      object_id: 'item-1',
    })
  })
})
