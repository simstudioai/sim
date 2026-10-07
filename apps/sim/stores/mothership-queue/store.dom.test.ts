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
