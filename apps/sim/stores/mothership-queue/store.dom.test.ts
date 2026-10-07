/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

describe('useMothershipQueueStore rehydration', () => {
  beforeEach(() => {
    useMothershipQueueStore.getState().reset()
    sessionStorage.clear()
  })

  it('restores the hold and retry fields of a queue saved in their older shape', async () => {
    sessionStorage.setItem(
      'mothership-queue',
      JSON.stringify({
        state: {
          queues: {
            'chat-A': [
              { id: 'for-user', content: 'a', retryRequired: true },
              { id: 'for-network', content: 'b', retryRequired: true, heldUntilOnline: true },
              { id: 'retrying', content: 'c', sendRetries: 2, notBefore: 1_000 },
              { id: 'plain', content: 'd' },
              { id: 'main-shape', content: 'e', retryRequired: false },
              {
                id: 'new-shape',
                content: 'f',
                hold: 'online',
                retry: { attempt: 1, notBefore: 5 },
              },
            ],
          },
        },
        version: 0,
      })
    )

    await useMothershipQueueStore.persist.rehydrate()

    expect(useMothershipQueueStore.getState().queues['chat-A']).toEqual([
      { id: 'for-user', content: 'a', hold: 'user' },
      { id: 'for-network', content: 'b', hold: 'online' },
      { id: 'retrying', content: 'c', retry: { attempt: 2, notBefore: 1_000 } },
      { id: 'plain', content: 'd' },
      { id: 'main-shape', content: 'e' },
      { id: 'new-shape', content: 'f', hold: 'online', retry: { attempt: 1, notBefore: 5 } },
    ])
  })

  it('treats a resumed message saved before the edit guard as possibly sent', async () => {
    sessionStorage.setItem(
      'mothership-queue',
      JSON.stringify({
        state: {
          queues: {
            'chat-A': [
              { id: 'saved-before', content: 'original', resumeUserMessageId: 'attempt-1' },
              {
                id: 'refused',
                content: 'original',
                resumeUserMessageId: 'attempt-2',
                admissionUnknown: false,
              },
              { id: 'plain', content: 'never sent' },
            ],
          },
        },
        version: 0,
      })
    )

    await useMothershipQueueStore.persist.rehydrate()

    const [savedBefore, refused, plain] = useMothershipQueueStore.getState().queues['chat-A'] ?? []
    expect(savedBefore?.admissionUnknown).toBe(true)
    expect(refused?.admissionUnknown).toBe(false)
    expect(plain?.admissionUnknown).toBeUndefined()
  })

  it('moves the reused id a saved Stop handoff carried onto the entry, over its own', async () => {
    const seed = { chatId: 'chat-A', supersededStreamId: 'previous-response', stopRequired: true }
    sessionStorage.setItem(
      'mothership-queue',
      JSON.stringify({
        state: {
          queues: {
            'chat-A': [
              {
                id: 'seed-only',
                content: 'a',
                queuedSendHandoff: { id: 'seed-only', ...seed, userMessageId: 'attempt-1' },
              },
              {
                id: 'never-sent',
                content: 'b',
                admissionUnknown: false,
                queuedSendHandoff: { id: 'never-sent', ...seed, userMessageId: 'attempt-2' },
              },
              {
                id: 'both',
                content: 'c',
                resumeUserMessageId: 'withdrawn-attempt',
                queuedSendHandoff: { id: 'both', ...seed, userMessageId: 'send-now-attempt' },
              },
            ],
          },
        },
        version: 0,
      })
    )

    await useMothershipQueueStore.persist.rehydrate()

    expect(useMothershipQueueStore.getState().queues['chat-A']).toEqual([
      {
        id: 'seed-only',
        content: 'a',
        resumeUserMessageId: 'attempt-1',
        admissionUnknown: true,
        queuedSendHandoff: { id: 'seed-only', ...seed },
      },
      {
        id: 'never-sent',
        content: 'b',
        resumeUserMessageId: 'attempt-2',
        admissionUnknown: false,
        queuedSendHandoff: { id: 'never-sent', ...seed },
      },
      {
        id: 'both',
        content: 'c',
        /** The id that build sent: the handoff's, ahead of the entry's. */
        resumeUserMessageId: 'send-now-attempt',
        admissionUnknown: true,
        queuedSendHandoff: { id: 'both', ...seed },
      },
    ])
  })
})
