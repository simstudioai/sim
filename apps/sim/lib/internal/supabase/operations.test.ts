/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { executeSupabaseStorageUpload } from '@/lib/internal/supabase/operations'

const BASE_INPUT = {
  projectId: 'project1234',
  apiKey: 'service-key',
  bucket: 'documents',
  fileName: 'hello.txt',
  path: null,
  contentType: null,
  cacheControl: null,
  upsert: false,
} as const

describe('executeSupabaseStorageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Key: 'documents/hello.txt' })))
  })

  it('uploads inline text with the exact provider and output paths', async () => {
    const response = await executeSupabaseStorageUpload(
      { ...BASE_INPUT, path: 'folder', fileData: 'hello, world' },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: {
        results: {
          path: 'folder/hello.txt',
          bucket: 'documents',
          publicUrl:
            'https://project1234.supabase.co/storage/v1/object/public/documents/folder/hello.txt',
        },
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://project1234.supabase.co/storage/v1/object/documents/folder/hello.txt',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('authorizes stored files before loading bytes', async () => {
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'text/plain',
    })

    const response = await executeSupabaseStorageUpload(
      {
        ...BASE_INPUT,
        fileData: {
          id: 'file-1',
          key: 'workspace/workspace-1/hello.txt',
          name: 'hello.txt',
          size: 5,
          type: 'text/plain',
          url: '/api/files/serve?key=workspace%2Fworkspace-1%2Fhello.txt',
        },
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(200)
    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/workspace-1/hello.txt',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledAfter(mocks.assertToolFileAccess)
  })

  it('preserves provider error details and status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message: 'Bucket not found', code: '404' }, { status: 404 })
    )

    const response = await executeSupabaseStorageUpload(
      { ...BASE_INPUT, fileData: 'hello' },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Bucket not found',
      details: { message: 'Bucket not found', code: '404' },
    })
  })

  it('forwards cancellation to the provider', async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw init?.signal?.reason
    })

    await expect(
      executeSupabaseStorageUpload(
        { ...BASE_INPUT, fileData: 'hello' },
        { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
