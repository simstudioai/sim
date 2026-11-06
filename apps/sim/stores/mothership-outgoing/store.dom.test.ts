/**
 * @vitest-environment jsdom
 *
 * Failure modes: a storage error reaching a send, so a full or blocked
 * sessionStorage stops messages going out; a tab open across the release keeping
 * the old queue's entries forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const entry = {
  id: 'message-a',
  payload: { content: 'Hi' },
  status: 'pending' as const,
  writtenAt: 1,
}

async function freshStore() {
  vi.resetModules()
  const { useMothershipOutgoingStore } = await import('@/stores/mothership-outgoing/store')
  return useMothershipOutgoingStore
}

describe('useMothershipOutgoingStore', () => {
  beforeEach(() => {
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

  it('resumes what a reload left in the journal', async () => {
    const first = await freshStore()
    first.getState().record('chat-a', [entry])

    const reloaded = await freshStore()

    expect(reloaded.getState().chats['chat-a']).toEqual([entry])
  })

  it('loads where merely naming sessionStorage throws, as in a sandboxed frame', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    try {
      const store = await freshStore()
      store.getState().record('chat-a', [entry])
      expect(store.getState().chats['chat-a']).toEqual([entry])
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    }
  })

  it('removes the old queue key once', async () => {
    window.sessionStorage.setItem('mothership-queue', '{"queues":{}}')

    await freshStore()

    expect(window.sessionStorage.getItem('mothership-queue')).toBeNull()
  })
})
