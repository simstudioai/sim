/**
 * @vitest-environment node
 */

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
    it('appends to the chat bucket', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().enqueue('chat-A', message('m2'))
      expect(useMothershipQueueStore.getState().queues['chat-A']?.map((m) => m.id)).toEqual([
        'm1',
        'm2',
      ])
    })

    it('keeps buckets isolated per chat', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().enqueue('chat-B', message('n1'))
      const state = useMothershipQueueStore.getState()
      expect(state.queues['chat-A']?.map((m) => m.id)).toEqual(['m1'])
      expect(state.queues['chat-B']?.map((m) => m.id)).toEqual(['n1'])
    })

    it('removes the chat bucket entirely when the last message is removed', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().remove('chat-A', 'm1')
      expect(useMothershipQueueStore.getState().queues['chat-A']).toBeUndefined()
    })

    it('clears editing when the editing message is removed', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().setEditing('chat-A', 'm1')
      useMothershipQueueStore.getState().remove('chat-A', 'm1')
      expect(useMothershipQueueStore.getState().editing['chat-A']).toBeUndefined()
    })

    it('preserves editing when a different message is removed', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().enqueue('chat-A', message('m2'))
      useMothershipQueueStore.getState().setEditing('chat-A', 'm1')
      useMothershipQueueStore.getState().remove('chat-A', 'm2')
      expect(useMothershipQueueStore.getState().editing['chat-A']).toBe('m1')
    })
  })

  describe('insertAt', () => {
    it('inserts at the requested index', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().enqueue('chat-A', message('m3'))
      useMothershipQueueStore.getState().insertAt('chat-A', 1, message('m2'))
      expect(useMothershipQueueStore.getState().queues['chat-A']?.map((m) => m.id)).toEqual([
        'm1',
        'm2',
        'm3',
      ])
    })

    it('clamps an out-of-range index to the end', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().insertAt('chat-A', 99, message('m2'))
      expect(useMothershipQueueStore.getState().queues['chat-A']?.map((m) => m.id)).toEqual([
        'm1',
        'm2',
      ])
    })

    it('ignores duplicate ids', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().insertAt('chat-A', 0, message('m1'))
      expect(useMothershipQueueStore.getState().queues['chat-A']?.length).toBe(1)
    })
  })

  describe('replaceAt', () => {
    it('overwrites content while preserving id and index', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1', 'orig-1'))
      useMothershipQueueStore.getState().enqueue('chat-A', message('m2', 'orig-2'))
      useMothershipQueueStore.getState().enqueue('chat-A', message('m3', 'orig-3'))

      useMothershipQueueStore.getState().replaceAt('chat-A', 'm2', { content: 'edited-2' })

      const queue = useMothershipQueueStore.getState().queues['chat-A']
      expect(queue?.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
      expect(queue?.[1]?.content).toBe('edited-2')
    })

    it('is a no-op when the id is no longer in the queue', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      const before = useMothershipQueueStore.getState().queues['chat-A']
      useMothershipQueueStore.getState().replaceAt('chat-A', 'missing', { content: 'x' })
      expect(useMothershipQueueStore.getState().queues['chat-A']).toBe(before)
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
    it('moves both queue and editing from sentinel to resolved chatId', () => {
      const pendingKey = 'pending::abc'
      useMothershipQueueStore.getState().enqueue(pendingKey, message('m1'))
      useMothershipQueueStore.getState().setEditing(pendingKey, 'm1')
      useMothershipQueueStore.getState().migrate(pendingKey, 'chat-X')
      const state = useMothershipQueueStore.getState()
      expect(state.queues[pendingKey]).toBeUndefined()
      expect(state.editing[pendingKey]).toBeUndefined()
      expect(state.queues['chat-X']?.map((m) => m.id)).toEqual(['m1'])
      expect(state.editing['chat-X']).toBe('m1')
    })

    it('is a no-op when source and target are the same', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      const before = useMothershipQueueStore.getState().queues['chat-A']
      useMothershipQueueStore.getState().migrate('chat-A', 'chat-A')
      expect(useMothershipQueueStore.getState().queues['chat-A']).toBe(before)
    })

    it('is a no-op when the source bucket is empty', () => {
      const before = useMothershipQueueStore.getState().queues
      useMothershipQueueStore.getState().migrate('nope', 'chat-X')
      expect(useMothershipQueueStore.getState().queues).toBe(before)
    })

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

  describe('clearChat', () => {
    it('drops queue and editing for the chat', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', message('m1'))
      useMothershipQueueStore.getState().setEditing('chat-A', 'm1')
      useMothershipQueueStore.getState().clearChat('chat-A')
      const state = useMothershipQueueStore.getState()
      expect(state.queues['chat-A']).toBeUndefined()
      expect(state.editing['chat-A']).toBeUndefined()
    })
  })

  describe('setEditing', () => {
    it('stores and clears the editing id', () => {
      useMothershipQueueStore.getState().setEditing('chat-A', 'm1')
      expect(useMothershipQueueStore.getState().editing['chat-A']).toBe('m1')
      useMothershipQueueStore.getState().setEditing('chat-A', null)
      expect(useMothershipQueueStore.getState().editing['chat-A']).toBeUndefined()
    })
  })
})
