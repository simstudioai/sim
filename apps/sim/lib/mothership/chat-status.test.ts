import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ChatStatusEvent,
  chatPubSub,
  publishChatStatusChanged,
} from '@/lib/mothership/chat-status'

/** Events as a subscriber receives them from the channel (process-local without Redis). */
let received: ChatStatusEvent[] = []
let unsubscribe: () => void = () => {}

beforeEach(() => {
  received = []
  unsubscribe = chatPubSub?.onStatusChanged((event) => received.push(event)) ?? (() => {})
})

afterEach(() => unsubscribe())

describe('chat status ownership', () => {
  it('names the chat owner on workspace events, so each member can tell their own chats', () => {
    publishChatStatusChanged(
      { workspaceId: 'ws-1', userId: 'user-1' },
      { chatId: 'chat-1', type: 'renamed' }
    )
    expect(received).toEqual([
      { workspaceId: 'ws-1', userId: 'user-1', chatId: 'chat-1', type: 'renamed' },
    ])
  })

  it('publishes a workspace event without an owner when the publisher does not know it', () => {
    publishChatStatusChanged({ workspaceId: 'ws-1' }, { chatId: 'chat-1', type: 'renamed' })
    expect(received).toEqual([{ workspaceId: 'ws-1', chatId: 'chat-1', type: 'renamed' }])
  })

  it.each(['completed'] as const)(
    'binds %s events to the organization and private chat owner',
    (type) => {
      publishChatStatusChanged(
        { organizationId: 'org-1', userId: 'user-1' },
        { chatId: 'chat-1', type }
      )
      expect(received).toEqual([
        { organizationId: 'org-1', userId: 'user-1', chatId: 'chat-1', type },
      ])
    }
  )

  it('does not broadcast an organization event without its private owner', () => {
    expect(() =>
      publishChatStatusChanged({ organizationId: 'org-1' }, { chatId: 'chat-1', type: 'created' })
    ).toThrow('Invalid organization chat owner')
    expect(received).toEqual([])
  })

  it('refuses ambiguous workspace and organization ownership', () => {
    expect(() =>
      publishChatStatusChanged(
        { workspaceId: 'ws-1', organizationId: 'org-1', userId: 'user-1' },
        { chatId: 'chat-1', type: 'created' }
      )
    ).toThrow('Invalid organization chat owner')
    expect(received).toEqual([])
  })
})
