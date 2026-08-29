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

/**
 * The storage path guards throw a plain `Error` on caller-supplied values.
 * Before they existed nothing here threw, so an unmapped throw would surface as
 * HTTP 500 and blame the server for the caller's `..` — while
 * `validateSupabaseProjectId` one line above already reports a bad project id
 * as 400. These assertions pin the attribution and the named message.
 */
describe('executeSupabaseStorageUpload path-guard failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Key: 'k' })))
  })

  it.each([
    ['a traversal path', { path: '../..', fileName: 'x.txt' }],
    ['an empty path segment', { path: 'a//b', fileName: 'x.txt' }],
    ['a bucket that is a dot segment', { bucket: '..', fileName: 'x.txt' }],
    ['a bucket carrying a separator', { bucket: 'a/b', fileName: 'x.txt' }],
  ])('reports %s as 400, not 500', async (_label, overrides) => {
    const response = await executeSupabaseStorageUpload(
      { ...BASE_INPUT, fileData: 'hello', ...overrides },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names the offending parameter in the error', async () => {
    const response = await executeSupabaseStorageUpload(
      { ...BASE_INPUT, bucket: '..', fileData: 'hello' },
      { userId: 'user-1', requestId: 'request-1' }
    )
    const body = (await response.json()) as { error?: string }

    expect(body.error).toMatch(/bucket/)
  })
})
