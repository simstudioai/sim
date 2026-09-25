import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { importPersonaAccounts } from '@/lib/internal/persona/operations'

describe('importPersonaAccounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('a,b\n1,2') })
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
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

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
