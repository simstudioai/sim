import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFilesWithinBudget: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

const discordMocks = vi.hoisted(() => ({
  sendDiscordMessage: vi.fn(),
}))

vi.mock('@/lib/internal/discord/client', () => ({
  sendDiscordMessage: discordMocks.sendDiscordMessage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFilesWithinBudget: fileMocks.downloadServableFilesWithinBudget,
}))

import { executeDiscordSendMessage } from '@/lib/internal/discord/operations'

describe('executeDiscordSendMessage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

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
