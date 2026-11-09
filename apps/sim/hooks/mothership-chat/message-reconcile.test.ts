import { describe, expect, it } from 'vitest'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import {
  findAssistantAfterOwner,
  markMessageStopped,
} from '@/hooks/mothership-chat/message-reconcile'

describe('markMessageStopped', () => {
  it.each(['executing', 'pending', 'awaiting_approval'] as const)(
    'settles a %s tool row as stopped',
    (state) => {
      const message: PersistedMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: '2026-09-29T00:00:00.000Z',
        contentBlocks: [
          {
            type: 'tool',
            endedAt: 1,
            toolCall: { id: 'call-1', name: 'gmail_read_v2', state },
          },
        ],
      }

      const stopped = markMessageStopped(message)

      expect(stopped.contentBlocks?.[0].toolCall?.state).toBe('cancelled')
    }
  )
})

describe('findAssistantAfterOwner', () => {
  const at = '2026-11-05T00:00:00.000Z'
  it('finds the answer past steering sent into the same turn, and stops at the next turn', () => {
    const messages: PersistedMessage[] = [
      { id: 'turn', role: 'user', content: 'Count', timestamp: at },
      { id: 'steer', role: 'user', content: 'Stop', timestamp: at, steering: { streamId: 'turn' } },
      { id: 'answer', role: 'assistant', content: '1', timestamp: at },
      { id: 'next', role: 'user', content: 'Again', timestamp: at },
    ]
    expect(findAssistantAfterOwner(messages, 0)).toBe(2)
    expect(findAssistantAfterOwner(messages.slice(3), 0)).toBe(-1)
  })
})
