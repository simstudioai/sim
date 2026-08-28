/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/pdf',
    })
    mocks.fetch.mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }))
  })

  it('authorizes one stored file and sends one abortable provider request', async () => {
    const controller = new AbortController()
    const result = await sendTelegramDocument(
      {
        botToken: 'token',
        chatId: 'chat-1',
        caption: '**report**',
        files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
      },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file.pdf',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ signal: controller.signal })
    )
    expect(result.output.files?.[0]).toEqual(
      expect.objectContaining({ name: 'file.pdf', data: 'AQID', size: 3 })
    )
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
