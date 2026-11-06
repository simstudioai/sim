/**
 * @vitest-environment jsdom
 *
 * Failure modes: a storage error reaching a send, so a full or blocked
 * sessionStorage stops messages going out; a tab open across the release keeping
 * the old queue's entries forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const entry = { id: 'message-a', payload: { content: 'Hi' }, status: 'pending' as const }

async function freshStore() {
  vi.resetModules()
  const { useMothershipOutgoingStore } = await import('@/stores/mothership-outgoing/store')
  return useMothershipOutgoingStore
}

describe('useMothershipOutgoingStore', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('keeps working in memory when the journal cannot be written', async () => {
    const store = await freshStore()
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
    })

    store.getState().record('chat-a', [entry])

    expect(store.getState().chats['chat-a']).toEqual([entry])
  })

  it('starts empty when the journal cannot be read', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem: () => {},
      setItem: () => {},
    })

    const store = await freshStore()

    expect(store.getState().chats).toEqual({})
  })

  it('resumes what a reload left in the journal', async () => {
    const first = await freshStore()
    first.getState().record('chat-a', [entry])

    const reloaded = await freshStore()

    expect(reloaded.getState().chats['chat-a']).toEqual([entry])
  })

  it('removes the old queue key once', async () => {
    window.sessionStorage.setItem('mothership-queue', '{"queues":{}}')

    await freshStore()

    expect(window.sessionStorage.getItem('mothership-queue')).toBeNull()
  })
})
