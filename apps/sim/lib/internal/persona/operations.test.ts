import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { importPersonaAccounts } from '@/lib/internal/persona/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

describe('importPersonaAccounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('a,b\n1,2') })
    mocks.fetch.mockResolvedValue(
      Response.json({
        data: {
          id: 'impr_1',
          attributes: { status: 'pending', 'successful-count': 0, 'error-count': 0 },
        },
      })
    )
  })

  it('fails closed before provider work when file access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      importPersonaAccounts(
        {
          apiKey: 'token',
          file: { key: 'workspace/file.csv', name: 'file.csv', size: 7 },
        },
        { userId: 'user-1', requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
