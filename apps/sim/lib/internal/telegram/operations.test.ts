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

import { sendTelegramDocument } from '@/lib/internal/telegram/operations'

describe('sendTelegramDocument', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/pdf',
    })
    mocks.fetch.mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }))
  })

  it('fails closed before materialization when file access is denied', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

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
