/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { writeChannelTool } from '@/tools/microsoft_teams/write_channel'
import { writeChatTool } from '@/tools/microsoft_teams/write_chat'

describe('Microsoft Teams operation configs', () => {
  it('preserves resolved variable values without HTTP-shaped metadata', () => {
    const chatInput = writeChatTool.operation.input({
      accessToken: '{{MICROSOFT_TEAMS_TOKEN}}',
      chatId: '<list_chats.chatId>',
      content: '<large_value.message>',
    })
    const channelInput = writeChannelTool.operation.input({
      accessToken: '{{MICROSOFT_TEAMS_TOKEN}}',
      teamId: '<list_teams.teamId>',
      channelId: '<list_channels.channelId>',
      content: '<large_value.message>',
    })

    expect(chatInput).toEqual({
      accessToken: '{{MICROSOFT_TEAMS_TOKEN}}',
      chatId: '<list_chats.chatId>',
      content: '<large_value.message>',
      files: null,
    })
    expect(channelInput).toEqual({
      accessToken: '{{MICROSOFT_TEAMS_TOKEN}}',
      teamId: '<list_teams.teamId>',
      channelId: '<list_channels.channelId>',
      content: '<large_value.message>',
      files: null,
    })
    expect('request' in writeChatTool).toBe(false)
    expect('request' in writeChannelTool).toBe(false)
  })
})
