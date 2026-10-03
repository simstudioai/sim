import { describe, expect, it } from 'vitest'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { markMessageStopped } from '@/app/workspace/[workspaceId]/home/hooks/message-reconcile'

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
