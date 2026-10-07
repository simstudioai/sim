import { beforeEach, describe, expect, it } from 'vitest'
import {
  liveQueueKey,
  liveQueuePosition,
  useMothershipQueueStore,
} from '@/stores/mothership-queue/store'
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
    it('treats a flagless handoff still waiting on its Stop as possibly sent', () => {
      /** Its id may be a re-queued message's earlier attempt, which a pending Stop says nothing about. */
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'legacy',
        content: 'original',
        queuedSendHandoff: {
          id: 'legacy',
          chatId: 'chat-A',
          supersededStreamId: 'previous-response',
          userMessageId: 'earlier-attempt',
          stopRequired: true,
        },
      })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'legacy', { content: 'edited' })

      expect(useMothershipQueueStore.getState().queues['chat-A']?.[0]).toMatchObject({
        content: 'original',
        admissionUnknown: true,
      })
    })

    it('reads a reused handoff id as possibly sent unless the entry says otherwise', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'sent',
        content: 'original',
        queuedSendHandoff: {
          id: 'sent',
          chatId: 'chat-A',
          supersededStreamId: 'previous-response',
          userMessageId: 'send-now-request',
        },
      })
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'waiting',
        content: 'original',
        queuedSendHandoff: {
          id: 'waiting',
          chatId: 'chat-A',
          supersededStreamId: 'previous-response',
          userMessageId: 'not-sent-yet',
          stopRequired: true,
        },
        /** A fresh id still waiting on its Stop, as the hook records it. */
        admissionUnknown: false,
      })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'sent', { content: 'edited' })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'waiting', { content: 'edited' })

      const [sent, waiting] = useMothershipQueueStore.getState().queues['chat-A'] ?? []
      expect(sent).toMatchObject({
        content: 'original',
        queuedSendHandoff: { userMessageId: 'send-now-request' },
      })
      expect(waiting?.content).toBe('edited')
    })

    it('treats any message resuming an earlier attempt as possibly sent, unless told otherwise', () => {
      useMothershipQueueStore
        .getState()
        .enqueue('chat-A', { id: 'resumed', content: 'original', resumeUserMessageId: 'attempt-1' })
      useMothershipQueueStore.getState().insertAt('chat-A', 0, {
        id: 'refused',
        content: 'original',
        resumeUserMessageId: 'attempt-2',
        admissionUnknown: false,
      })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'resumed', { content: 'edited' })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'refused', { content: 'edited' })

      const [refused, resumed] = useMothershipQueueStore.getState().queues['chat-A'] ?? []
      expect(resumed).toMatchObject({ content: 'original', resumeUserMessageId: 'attempt-1' })
      expect(refused?.content).toBe('edited')
    })

    it('leaves a first message the server may already hold unchanged, with its id', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'm1',
        content: 'original',
        resumeUserMessageId: 'first-attempt',
        admissionUnknown: true,
      })
      useMothershipQueueStore.getState().replaceAt('chat-A', 'm1', { content: 'edited' })
      expect(useMothershipQueueStore.getState().queues['chat-A']?.[0]).toMatchObject({
        content: 'original',
        resumeUserMessageId: 'first-attempt',
      })
    })

    it('editing preserves an unresolved Stop while replacing the prior request identity', () => {
      useMothershipQueueStore.getState().enqueue('chat-A', {
        id: 'm1',
        content: 'original',
        hold: 'user',
        resumeUserMessageId: 'prior-request',
        /** Its Stop never settled, so it was never sent: the server cannot hold it. */
        admissionUnknown: false,
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
      expect(edited?.hold).toBeUndefined()
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

  describe('holdForSurface', () => {
    it("hands a dead chatless mount's queue to the next mount of its surface only", () => {
      useMothershipQueueStore.getState().enqueue('pending::dead', message('m1'))
      useMothershipQueueStore.getState().holdForSurface('pending::dead', 'ws-1:home')

      useMothershipQueueStore.getState().adoptHeldSends('pending::other', 'ws-1:workflow-1')
      expect(useMothershipQueueStore.getState().queues['pending::other']).toBeUndefined()

      useMothershipQueueStore.getState().adoptHeldSends('pending::next', 'ws-1:home')
      const state = useMothershipQueueStore.getState()
      expect(state.queues['pending::next']?.map((m) => m.id)).toEqual(['m1'])
      expect(state.queues['pending::dead']).toBeUndefined()
    })
  })

  describe('migrate', () => {
    it('points a late write at the chat a new-chat queue moved to, even an empty one', () => {
      useMothershipQueueStore.getState().migrate('pending::empty', 'chat-X')
      useMothershipQueueStore.getState().migrate('chat-X', 'chat-X')

      expect(liveQueueKey('pending::empty')).toBe('chat-X')
      expect(liveQueueKey('pending::never-moved')).toBe('pending::never-moved')
      expect(liveQueueKey('chat-X')).toBe('chat-X')
    })

    it('keeps a late write behind the messages the chat queue already held', () => {
      useMothershipQueueStore.getState().enqueue('chat-Y', message('older-1'))
      useMothershipQueueStore.getState().enqueue('chat-Y', message('older-2'))
      useMothershipQueueStore.getState().enqueue('pending::moved', message('moved'))
      useMothershipQueueStore.getState().migrate('pending::moved', 'chat-Y')

      const position = liveQueuePosition('pending::moved', [])
      useMothershipQueueStore.getState().insertAt(position.chatKey, position.index, message('late'))

      expect(position).toEqual({ chatKey: 'chat-Y', index: 2 })
      expect(useMothershipQueueStore.getState().queues['chat-Y']?.map((m) => m.id)).toEqual([
        'older-1',
        'older-2',
        'late',
        'moved',
      ])
    })

    it('keeps the first move when the same new-chat queue is migrated again', () => {
      useMothershipQueueStore.getState().enqueue('chat-W', message('older'))
      useMothershipQueueStore.getState().enqueue('pending::twice', message('moved'))
      useMothershipQueueStore.getState().migrate('pending::twice', 'chat-W')
      useMothershipQueueStore.getState().enqueue('chat-W', message('written-later'))
      useMothershipQueueStore.getState().migrate('pending::twice', 'chat-W')

      const position = liveQueuePosition('pending::twice', [])
      useMothershipQueueStore.getState().insertAt(position.chatKey, position.index, message('late'))

      expect(useMothershipQueueStore.getState().queues['chat-W']?.map((m) => m.id)).toEqual([
        'older',
        'late',
        'moved',
        'written-later',
      ])
    })

    it('keeps a late write in order when messages ahead of it were removed meanwhile', () => {
      useMothershipQueueStore.getState().enqueue('chat-Z', message('older'))
      useMothershipQueueStore.getState().enqueue('pending::sent', message('later'))
      useMothershipQueueStore.getState().migrate('pending::sent', 'chat-Z')
      useMothershipQueueStore.getState().remove('chat-Z', 'older')

      const position = liveQueuePosition('pending::sent', [])
      useMothershipQueueStore
        .getState()
        .insertAt(position.chatKey, position.index, message('follow-up'))

      expect(useMothershipQueueStore.getState().queues['chat-Z']?.map((m) => m.id)).toEqual([
        'follow-up',
        'later',
      ])
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

    it('lifts only the delete a restore saw, never a later one', () => {
      useMothershipQueueStore.getState().clearChat('chat-X')
      const seen = useMothershipQueueStore.getState().cleared['chat-X']
      useMothershipQueueStore.getState().reopenRestoredChat('chat-X')
      useMothershipQueueStore.getState().clearChat('chat-X')

      useMothershipQueueStore.getState().liftDelete('chat-X', seen)
      useMothershipQueueStore.getState().enqueue('chat-X', message('after-stale-restore'))
      expect(useMothershipQueueStore.getState().queues['chat-X']).toBeUndefined()

      const latest = useMothershipQueueStore.getState().cleared['chat-X']
      useMothershipQueueStore.getState().liftDelete('chat-X', latest)
      useMothershipQueueStore.getState().enqueue('chat-X', message('after-restore'))
      expect(useMothershipQueueStore.getState().queues['chat-X']?.map((m) => m.id)).toEqual([
        'after-restore',
      ])
    })

    it('does not move a new chat surface queue into a chat deleted meanwhile', () => {
      useMothershipQueueStore.getState().enqueue('pending::abc', message('pending-1'))
      useMothershipQueueStore.getState().clearChat('chat-X')
      useMothershipQueueStore.getState().migrate('pending::abc', 'chat-X')
      const state = useMothershipQueueStore.getState()
      expect(state.queues['chat-X']).toBeUndefined()
      expect(state.queues['pending::abc']).toBeUndefined()
    })
  })
})
