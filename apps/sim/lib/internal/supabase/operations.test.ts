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
    mocks.assertToolFileAccess.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Key: 'documents/hello.txt' })))
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
})
