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
})
