/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const legacyNewestFirst = {
    state: {
      messages: [
        {
          id: 'msg-2',
          content: 'response',
          workflowId: 'wf-1',
          type: 'workflow',
          timestamp: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 'msg-1',
          content: 'hi',
          workflowId: 'wf-1',
          type: 'user',
          timestamp: '2026-07-13T00:00:00.000Z',
        },
      ],
    },
    version: 0,
  }
  window.localStorage.setItem('chat-store', JSON.stringify(legacyNewestFirst))
})

import { useChatStore } from '@/stores/chat/store'

describe('chat store message ordering', () => {
  it('migrates v0 persisted messages from newest-first to insertion order', () => {
    const messages = useChatStore.getState().messages
    expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])
  })

  describe('addMessage', () => {
    beforeEach(() => {
      useChatStore.setState({ messages: [] })
    })

    it('appends messages so insertion order is conversation order, even with identical timestamps', () => {
      const { addMessage } = useChatStore.getState()
      const timestamp = new Date().toISOString()

      addMessage({ content: 'hi', workflowId: 'wf-1', type: 'user', timestamp } as any)
      addMessage({ content: '', workflowId: 'wf-1', type: 'workflow', timestamp } as any)

      const types = useChatStore.getState().messages.map((m) => m.type)
      expect(types).toEqual(['user', 'workflow'])
    })

    it('keeps only the most recent messages when trimming to the cap', () => {
      const { addMessage } = useChatStore.getState()

      for (let i = 0; i < 55; i++) {
        addMessage({ content: `m${i}`, workflowId: 'wf-1', type: 'user' })
      }

      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(50)
      expect(messages[0].content).toBe('m5')
      expect(messages[messages.length - 1].content).toBe('m54')
    })
  })
})
