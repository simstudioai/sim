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

import { sendTelegramDocument } from '@/lib/internal/telegram/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

describe('sendTelegramDocument', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/pdf',
    })
    mocks.fetch.mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }))
  })

  it('fails closed before materialization when file access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      sendTelegramDocument(
        {
          botToken: 'token',
          chatId: 'chat-1',
          files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
        },
        { userId: 'user-1', requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
