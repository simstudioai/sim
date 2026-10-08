import { describe, expect, it, vi } from 'vitest'

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }))
vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({ publish, subscribe: vi.fn(), dispose: vi.fn() }),
}))

import { publishChatStatusChanged } from '@/lib/mothership/chat-status'

describe('chat status ownership', () => {
  it('names the chat owner on workspace events, so each member can tell their own chats', () => {
    publishChatStatusChanged(
      { workspaceId: 'ws-1', userId: 'user-1' },
      { chatId: 'chat-1', type: 'renamed' }
    )
    expect(publish).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      chatId: 'chat-1',
      type: 'renamed',
    })
  })

  it('publishes a workspace event without an owner when the publisher does not know it', () => {
    publishChatStatusChanged({ workspaceId: 'ws-1' }, { chatId: 'chat-1', type: 'renamed' })
    expect(publish).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      type: 'renamed',
    })
  })

  it.each(['completed'] as const)(
    'binds %s events to the organization and private chat owner',
    (type) => {
      publishChatStatusChanged(
        { organizationId: 'org-1', userId: 'user-1' },
        { chatId: 'chat-1', type }
      )
      expect(publish).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-1',
        chatId: 'chat-1',
        type,
      })
    }
  )

  it('does not broadcast an organization event without its private owner', () => {
    expect(() =>
      publishChatStatusChanged({ organizationId: 'org-1' }, { chatId: 'chat-1', type: 'created' })
    ).toThrow('Invalid organization chat owner')
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses ambiguous workspace and organization ownership', () => {
    expect(() =>
      publishChatStatusChanged(
        { workspaceId: 'ws-1', organizationId: 'org-1', userId: 'user-1' },
        { chatId: 'chat-1', type: 'created' }
      )
    ).toThrow('Invalid organization chat owner')
    expect(publish).not.toHaveBeenCalled()
  })
})
