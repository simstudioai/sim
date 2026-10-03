import { beforeEach, describe, expect, it } from 'vitest'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'
import type { QueuedMothershipMessage } from '@/stores/mothership-queue/types'

const message = (id: string, content = `content-${id}`): QueuedMothershipMessage => ({
  id,
  content,
})

describe('useMothershipQueueStore', () => {
  beforeEach(() => {
    useMothershipQueueStore.getState().reset()
  })

  describe('enqueue / remove', () => {
    it('keeps buckets isolated per chat', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().enqueue('chat-B', message('n1'))
      const state = useMothershipQueueStore.getState()
      expect(state.queues['chat-A']?.map((m) => m.id)).toEqual(['m1'])
      expect(state.queues['chat-B']?.map((m) => m.id)).toEqual(['n1'])
    })

    it('clears editing when the editing message is removed', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().setEditing('chat-A', 'm1')
      useMothershipQueueStore.getState().remove('chat-A', 'm1')
      expect(useMothershipQueueStore.getState().editing['chat-A']).toBeUndefined()
    })
  })

  describe('replaceAt', () => {
    it('editing preserves an unresolved Stop while replacing the prior request identity', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'm1',
        content: 'original',
        retryRequired: true,
        resumeUserMessageId: 'prior-request',
        queuedSendHandoff: {
          id: 'm1',
          chatId: 'chat-A',
          supersededStreamId: 'previous-response',
          userMessageId: 'prior-request',
          stopRequired: true,
        },
      })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'm1', { content: 'corrected' })
      const edited = useMothershipQueueStore.getState().queues['chat-A']?.[0]
      expect(edited).toMatchObject({
        id: 'm1',
        content: 'corrected',
        queuedSendHandoff: {
          id: 'm1',
          chatId: 'chat-A',
          supersededStreamId: 'previous-response',
          stopRequired: true,
        },
      })
      expect(edited?.queuedSendHandoff?.userMessageId).toBeUndefined()
      expect(edited?.resumeUserMessageId).toBeUndefined()
      expect(edited?.retryRequired).toBeUndefined()
    })

    it('strips queuedSendHandoff on edit so a fresh handoff is minted at send time', () => {
      const original: QueuedMothershipMessage = {
        id: 'm1',
        content: 'orig',
        queuedSendHandoff: { id: 'm1', supersededStreamId: 'stream-x' },
      }
      useMothershipQueueStore.getState().enqueue('chat-A', original)
      useMothershipQueueStore.getState().replaceAt('chat-A', 'm1', { content: 'edited' })
      const replaced = useMothershipQueueStore.getState().queues['chat-A']?.[0]
      expect(replaced?.queuedSendHandoff).toBeUndefined()
      expect(replaced?.content).toBe('edited')
    })
  })

  describe('migrate', () => {
    it('merges into an existing destination bucket instead of overwriting', () => {
      useMothershipQueueStore.getState().enqueue('chat-X', message('existing-1'))
      useMothershipQueueStore.getState().enqueue('chat-X', message('existing-2'))
      useMothershipQueueStore.getState().enqueue('pending::abc', message('pending-1'))
      useMothershipQueueStore.getState().migrate('pending::abc', 'chat-X')
      expect(useMothershipQueueStore.getState().queues['chat-X']?.map((m) => m.id)).toEqual([
        'existing-1',
        'existing-2',
        'pending-1',
      ])
      expect(useMothershipQueueStore.getState().queues['pending::abc']).toBeUndefined()
    })
  })
})
