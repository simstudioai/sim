import { describe, expect, it } from 'vitest'
import {
  v2ChatDetailSchema,
  v2GetChatQuerySchema,
  v2ListChatsQuerySchema,
  v2RenameChatBodySchema,
} from '@/lib/api/contracts/v2/chats'

describe('v2ListChatsQuerySchema', () => {
  it('defaults to a bounded page and clamps caller-provided limits', () => {
    expect(v2ListChatsQuerySchema.parse({ workspaceId: 'workspace-1' }).limit).toBe(30)
    expect(v2ListChatsQuerySchema.parse({ workspaceId: 'workspace-1', limit: '0' }).limit).toBe(1)
    expect(v2ListChatsQuerySchema.parse({ workspaceId: 'workspace-1', limit: '500' }).limit).toBe(
      100
    )
    expect(v2ListChatsQuerySchema.parse({ workspaceId: 'workspace-1', limit: '2.9' }).limit).toBe(2)
  })

  it('rejects empty search and cursor values', () => {
    expect(
      v2ListChatsQuerySchema.safeParse({ workspaceId: 'workspace-1', search: '' }).success
    ).toBe(false)
    expect(
      v2ListChatsQuerySchema.safeParse({ workspaceId: 'workspace-1', cursor: '' }).success
    ).toBe(false)
  })
})

describe('v2GetChatQuerySchema', () => {
  it('parses text booleans without treating "false" as truthy', () => {
    expect(v2GetChatQuerySchema.parse({ workspaceId: 'workspace-1' }).readOnly).toBe(false)
    expect(
      v2GetChatQuerySchema.parse({ workspaceId: 'workspace-1', readOnly: false }).readOnly
    ).toBe(false)
    expect(
      v2GetChatQuerySchema.parse({ workspaceId: 'workspace-1', readOnly: true }).readOnly
    ).toBe(true)
    expect(
      v2GetChatQuerySchema.parse({ workspaceId: 'workspace-1', readOnly: 'false' }).readOnly
    ).toBe(false)
    expect(
      v2GetChatQuerySchema.parse({ workspaceId: 'workspace-1', readOnly: 'true' }).readOnly
    ).toBe(true)
  })
})

describe('v2ChatDetailSchema', () => {
  it('accepts only the display-safe transcript projection', () => {
    const detail = {
      id: 'chat-1',
      title: 'Release plan',
      active: false,
      continuationToken: 'opaque-token',
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'Ready',
          timestamp: '2026-08-07T12:00:00.000Z',
          contentBlocks: [{ type: 'tool', result: 'private' }],
        },
      ],
    }

    expect(v2ChatDetailSchema.parse(detail)).toEqual({
      ...detail,
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'Ready',
          timestamp: '2026-08-07T12:00:00.000Z',
        },
      ],
    })
  })
})

describe('v2RenameChatBodySchema', () => {
  it('trims a bounded title and rejects empty or unknown input', () => {
    expect(
      v2RenameChatBodySchema.parse({ workspaceId: 'workspace-1', title: '  Release plan  ' })
    ).toEqual({ workspaceId: 'workspace-1', title: 'Release plan' })
    expect(
      v2RenameChatBodySchema.safeParse({ workspaceId: 'workspace-1', title: '   ' }).success
    ).toBe(false)
    expect(
      v2RenameChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        title: 'Release plan',
        extra: true,
      }).success
    ).toBe(false)
    expect(
      v2RenameChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        title: 'x'.repeat(201),
      }).success
    ).toBe(false)
  })
})
