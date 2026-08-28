/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteMicrosoftTeamsChatMessage: vi.fn(),
  writeMicrosoftTeamsChannelMessage: vi.fn(),
  writeMicrosoftTeamsChatMessage: vi.fn(),
}))

vi.mock('@/lib/internal/microsoft-teams/operations', () => ({
  deleteMicrosoftTeamsChatMessage: mocks.deleteMicrosoftTeamsChatMessage,
  writeMicrosoftTeamsChannelMessage: mocks.writeMicrosoftTeamsChannelMessage,
  writeMicrosoftTeamsChatMessage: mocks.writeMicrosoftTeamsChatMessage,
}))

import { executeMicrosoftTeamsTool } from '@/lib/internal/microsoft-teams/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeMicrosoftTeamsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMicrosoftTeamsChatMessage.mockResolvedValue({ success: true, output: {} })
    mocks.writeMicrosoftTeamsChannelMessage.mockResolvedValue({ success: true, output: {} })
    mocks.writeMicrosoftTeamsChatMessage.mockResolvedValue({ success: true, output: {} })
  })

  it('dispatches typed input with cancellation', async () => {
    const controller = new AbortController()
    const input = { accessToken: 'token', chatId: 'chat-1', messageId: 'message-1' }
    const request: InternalToolOperationCall = {
      toolId: 'microsoft_teams_delete_chat_message',
      input,
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeMicrosoftTeamsTool(request)).status).toBe(200)
    expect(mocks.deleteMicrosoftTeamsChatMessage).toHaveBeenCalledWith(input, {
      signal: controller.signal,
    })
  })

  it.each([
    {
      toolId: 'microsoft_teams_write_chat',
      input: { accessToken: 'token', chatId: 'chat-1', content: 'hello', files: null },
      operation: mocks.writeMicrosoftTeamsChatMessage,
    },
    {
      toolId: 'microsoft_teams_write_channel',
      input: {
        accessToken: 'token',
        teamId: 'team-1',
        channelId: 'channel-1',
        content: 'hello',
        files: null,
      },
      operation: mocks.writeMicrosoftTeamsChannelMessage,
    },
  ])('dispatches $toolId with trusted execution context', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    const context = { ...createExecutionContext(), userId: 'user-1' }
    const response = await executeMicrosoftTeamsTool({
      toolId,
      input,
      headers: new Headers(),
      context,
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      signal: controller.signal,
      userId: 'user-1',
    })
  })
})
