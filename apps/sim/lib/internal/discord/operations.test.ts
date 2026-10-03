import { fileUtilsMock } from '@sim/testing/mocks/file-utils.mock'
import { fileUtilsServerMock } from '@sim/testing/mocks/file-utils-server.mock'
import { filesAuthorizationMock } from '@sim/testing/mocks/files-authorization.mock'
import { describe, expect, it, vi } from 'vitest'

const discordMocks = vi.hoisted(() => ({
  sendDiscordMessage: vi.fn(),
}))

vi.mock('@/lib/internal/discord/client', () => ({
  sendDiscordMessage: discordMocks.sendDiscordMessage,
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { executeDiscordSendMessage } from '@/lib/internal/discord/operations'

describe('executeDiscordSendMessage', () => {
  it('returns a committed text message when cancellation arrives after the send', async () => {
    const controller = new AbortController()
    discordMocks.sendDiscordMessage.mockImplementation(async () => {
      controller.abort()
      return { id: 'message-1', content: 'hello' }
    })

    await expect(
      executeDiscordSendMessage(
        { botToken: 'bot-token', channelId: '123', content: 'hello' },
        {
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        }
      )
    ).resolves.toEqual({
      success: true,
      output: {
        data: { id: 'message-1', content: 'hello' },
        message: 'hello',
      },
    })
  })
})
