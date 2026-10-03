import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { executeSupabaseStorageUpload } from '@/lib/internal/supabase/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

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
    mockAssertToolFileAccess.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Key: 'documents/hello.txt' })))
  })

  it('authorizes stored files before loading bytes', async () => {
    mockDownloadServableFileFromStorage.mockResolvedValue({
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
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      'workspace/workspace-1/hello.txt',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledAfter(mockAssertToolFileAccess)
  })
})
