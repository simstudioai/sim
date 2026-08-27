/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  fetch: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import {
  deleteMicrosoftTeamsChatMessage,
  writeMicrosoftTeamsChatMessage,
} from '@/lib/internal/microsoft-teams/operations'

describe('deleteMicrosoftTeamsChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processFilesToUserFiles.mockReturnValue([])
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'user-1' })).mockResolvedValueOnce(
      new Response(null, {
        status: 204,
      })
    )
  })

  it('uses the authenticated Graph user and soft-deletes exactly once', async () => {
    const controller = new AbortController()
    const result = await deleteMicrosoftTeamsChatMessage(
      { accessToken: 'token', chatId: ' chat-1 ', messageId: ' message-1 ' },
      { signal: controller.signal }
    )

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      '/users/user-1/chats/chat-1/messages/message-1/softDelete'
    )
    expect(mocks.fetch.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST', signal: controller.signal })
    )
    expect(result.output).toEqual({
      deleted: true,
      messageId: 'message-1',
      metadata: { messageId: 'message-1', chatId: 'chat-1' },
    })
  })

  it('sends plain chat content through the same cancellable operation path', async () => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue(
      Response.json({
        id: 'message-1',
        chatId: 'chat-1',
        body: { content: 'hello' },
        createdDateTime: '2026-01-01T00:00:00Z',
        webUrl: 'https://teams.example/message-1',
      })
    )
    const controller = new AbortController()
    const result = await writeMicrosoftTeamsChatMessage(
      { accessToken: 'token', chatId: ' chat-1 ', content: 'hello', files: null },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch.mock.calls[0][0]).toContain('/chats/chat-1/messages')
    expect(mocks.fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'POST', signal: controller.signal })
    )
    expect(result.output).toEqual({
      updatedContent: true,
      metadata: {
        messageId: 'message-1',
        chatId: 'chat-1',
        content: 'hello',
        createdTime: '2026-01-01T00:00:00Z',
        url: 'https://teams.example/message-1',
      },
    })
  })

  it('resolves mentions in-process while preserving the enhanced output envelope', async () => {
    mocks.fetch.mockReset()
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({
          value: [{ id: 'member-1', displayName: 'Ada', userIdentityType: 'aadUser' }],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'message-1',
          chatId: 'chat-1',
          body: { content: '<at id="0">Ada</at> hello' },
        })
      )
    const result = await writeMicrosoftTeamsChatMessage(
      { accessToken: 'token', chatId: 'chat-1', content: '<at>Ada</at> hello', files: null },
      { requestId: 'request-1', userId: 'user-1' }
    )
    const sentBody = JSON.parse(String(mocks.fetch.mock.calls[1][1]?.body))

    expect(sentBody).toMatchObject({
      body: { contentType: 'html', content: '<at id="0">Ada</at> hello' },
      mentions: [{ id: 0, mentionText: 'Ada' }],
    })
    expect(result.output).toMatchObject({
      updatedContent: true,
      metadata: { chatId: 'chat-1', attachmentCount: 0 },
      files: [],
    })
  })
})
