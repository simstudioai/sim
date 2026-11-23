/**
 * Agent tool calls pass the operation only in context and supply arguments under the tool's param
 * names, so the Discord mapping must run there; canvas "No change" flags must stay unsent.
 */
import { describe, expect, it } from 'vitest'
import { DiscordV2Block } from '@/blocks/blocks/discord'
import { discordAddReactionTool } from '@/tools/discord/add_reaction'
import { discordArchiveThreadTool } from '@/tools/discord/archive_thread'
import { discordBanMemberTool } from '@/tools/discord/ban_member'
import { discordBulkDeleteMessagesTool } from '@/tools/discord/bulk_delete_messages'
import { discordCreateChannelTool } from '@/tools/discord/create_channel'
import { discordGetMessagesTool } from '@/tools/discord/get_messages'
import { discordSendMessageTool } from '@/tools/discord/send_message'
import { discordUpdateMemberTool } from '@/tools/discord/update_member'
import { discordUpdateRoleTool } from '@/tools/discord/update_role'
import type { ToolConfig } from '@/tools/types'

function sentParams(
  inputs: Record<string, unknown>,
  context?: { operation: string }
): Record<string, unknown> {
  const mapper = DiscordV2Block.tools.config?.params
  if (!mapper) throw new Error('Discord block has no params mapper')
  return { ...inputs, ...mapper(inputs, context) }
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : url
}

function requestBody(tool: ToolConfig, params: Record<string, unknown>): unknown {
  const build = tool.request.body
  if (typeof build !== 'function') throw new Error(`${tool.id} has no request body`)
  return build(params)
}

describe('Discord agent tool calls', () => {
  it.each([
    ['a comma list from the tool row', '111, 222'],
    ['an array from the model', ['111', '222']],
  ])('bulk deletes the message IDs given as %s', (_label, messageIds) => {
    const params = sentParams(
      { botToken: 'bot', serverId: '1', channelId: '9', messageIds },
      { operation: 'discord_bulk_delete_messages' }
    )
    expect(requestBody(discordBulkDeleteMessagesTool, params)).toEqual({
      messages: ['111', '222'],
    })
  })

  it.each([
    [true, true],
    ['false', false],
  ])('sends archived %j to Discord as the boolean %j', (archived, expected) => {
    const params = sentParams(
      { botToken: 'bot', serverId: '1', threadId: '7', archived },
      { operation: 'discord_archive_thread' }
    )
    expect(requestBody(discordArchiveThreadTool, params)).toEqual({ archived: expected })
  })

  it('runs a channel operation without a server ID, but not a guild operation', () => {
    const params = sentParams(
      { botToken: 'bot', channelId: '9', messageId: '8', emoji: '👍' },
      { operation: 'discord_add_reaction' }
    )
    expect(requestUrl(discordAddReactionTool, params)).toBe(
      'https://discord.com/api/v10/channels/9/messages/8/reactions/%F0%9F%91%8D/@me'
    )
    expect(() =>
      sentParams({ botToken: 'bot', userId: '5' }, { operation: 'discord_get_member' })
    ).toThrow('Server ID is required')
  })

  it("pages messages from the model's cursor, never from a stale pinned-messages timestamp", () => {
    const agent = sentParams(
      { botToken: 'bot', serverId: '1', channelId: '9', before: '123' },
      { operation: 'discord_get_messages' }
    )
    expect(requestUrl(discordGetMessagesTool, agent)).toBe(
      'https://discord.com/api/v10/channels/9/messages?limit=10&before=123'
    )

    const canvas = sentParams({
      operation: 'discord_get_messages',
      botToken: 'bot',
      serverId: '1',
      channelId: '9',
      before: '2026-01-01T00:00:00Z',
    })
    expect(requestUrl(discordGetMessagesTool, canvas)).toBe(
      'https://discord.com/api/v10/channels/9/messages?limit=10'
    )
  })

  it("creates the model's channel type over the tool row's seeded text-channel option", () => {
    const agent = sentParams(
      { botToken: 'bot', serverId: '1', name: 'vc', channelType: '0', type: 2 },
      { operation: 'discord_create_channel' }
    )
    expect(requestBody(discordCreateChannelTool, agent)).toEqual({ name: 'vc', type: 2 })

    const canvas = sentParams({
      operation: 'discord_create_channel',
      botToken: 'bot',
      serverId: '1',
      name: 'vc',
      channelType: '2',
    })
    expect(requestBody(discordCreateChannelTool, canvas)).toEqual({ name: 'vc', type: 2 })
  })

  it("bans with the model's message purge window over the tool row's seeded zero days", () => {
    const agent = sentParams(
      {
        botToken: 'bot',
        serverId: '1',
        userId: '5',
        deleteMessageDays: '0',
        deleteMessageSeconds: 604800,
      },
      { operation: 'discord_ban_member' }
    )
    expect(requestBody(discordBanMemberTool, agent)).toEqual({ delete_message_seconds: 604800 })

    const canvas = sentParams({
      operation: 'discord_ban_member',
      botToken: 'bot',
      serverId: '1',
      userId: '5',
      deleteMessageDays: '7',
    })
    expect(requestBody(discordBanMemberTool, canvas)).toEqual({ delete_message_seconds: 604800 })
  })
})

describe('Discord canvas "No change" flags', () => {
  it('renames a member without touching their voice mute or deafen state', () => {
    const params = sentParams({
      operation: 'discord_update_member',
      botToken: 'bot',
      serverId: '1',
      userId: '5',
      nick: 'Ada',
      mute: '',
      deaf: '',
    })
    expect(requestBody(discordUpdateMemberTool, params)).toEqual({ nick: 'Ada' })
  })

  it('renames a role without changing whether it is hoisted or mentionable', () => {
    const params = sentParams({
      operation: 'discord_update_role',
      botToken: 'bot',
      serverId: '1',
      roleId: '3',
      name: 'Mods',
      hoist: '',
      mentionable: '',
    })
    expect(requestBody(discordUpdateRoleTool, params)).toEqual({ name: 'Mods' })
  })
})

describe('Discord request paths', () => {
  it('rejects an ID that would steer the bot request to another endpoint', () => {
    expect(() =>
      requestUrl(discordAddReactionTool, {
        botToken: 'bot',
        channelId: '9/../../guilds/1',
        messageId: '8',
        emoji: 'x',
      })
    ).toThrow('channelId cannot contain a path separator')
  })
})

describe('Discord send message', () => {
  it('posts a file-only message without placeholder text', () => {
    const input = discordSendMessageTool.operation.input({
      botToken: 'bot',
      serverId: '1',
      channelId: '9',
      files: [{ id: 'f', name: 'a.png', url: 'u', size: 1, type: 'image/png', key: 'k' }],
    } as never) as { content?: string }
    expect(input.content).toBeUndefined()
  })
})
