/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

beforeEach(() => {
  localStorage.clear()
  useMothershipEffortStore.getState().reset()
})

describe('Build reasoning preferences', () => {
  it('updates a saved Opus selection to Opus 5.5 and drops a saved global effort', async () => {
    localStorage.setItem(
      'mothership-effort',
      JSON.stringify({
        version: 0,
        state: { effort: 'xhigh', modelSelection: { model: 'claude-opus-5', fastMode: false } },
      })
    )
    await useMothershipEffortStore.persist.rehydrate()
    expect(useMothershipEffortStore.getState()).toMatchObject({
      newChatEffort: null,
      modelSelection: { model: 'claude-opus-5-5', fastMode: false },
    })
    useMothershipEffortStore.getState().setFastMode(true)
    expect(JSON.parse(localStorage.getItem('mothership-effort')!).state).toEqual({
      modelSelection: { model: 'claude-opus-5-5', fastMode: false },
    })
  })

  it('restores Fast mode but not a new chat effort pick across reloads', async () => {
    useMothershipEffortStore.getState().setNewChatEffort('low')
    useMothershipEffortStore.getState().setFastMode(true)
    const saved = localStorage.getItem('mothership-effort')!
    useMothershipEffortStore.getState().reset()
    localStorage.setItem('mothership-effort', saved)
    await useMothershipEffortStore.persist.rehydrate()
    expect(useMothershipEffortStore.getState()).toMatchObject({
      newChatEffort: null,
      modelSelection: { model: 'gpt-6-astra', fastMode: true },
    })
  })

  it('keeps a newer chat pick when an older pick fails to save', () => {
    const store = useMothershipEffortStore.getState()
    const low = store.setChatEffort('chat-1', 'low')
    const high = store.setChatEffort('chat-1', 'high')
    store.dropChatEffort('chat-1', low)
    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('high')
    store.dropChatEffort('chat-1', high)
    expect(useMothershipEffortStore.getState().chatEfforts).toEqual({})
  })

  it('keeps a newer pick of the same value when the first pick fails to save', () => {
    const store = useMothershipEffortStore.getState()
    const first = store.setChatEffort('chat-1', 'low')
    store.setChatEffort('chat-1', 'high')
    const latest = store.setChatEffort('chat-1', 'low')
    store.dropChatEffort('chat-1', first)
    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('low')
    store.dropChatEffort('chat-1', latest)
    expect(useMothershipEffortStore.getState().chatEfforts).toEqual({})
  })

  it('keeps an adopted new-chat pick when a stale save token fails', () => {
    const store = useMothershipEffortStore.getState()
    const stale = store.setChatEffort('chat-1', 'low')
    store.adoptNewChatEffort('chat-1', 'low')
    store.dropChatEffort('chat-1', stale)
    expect(useMothershipEffortStore.getState().chatEfforts['chat-1']?.effort).toBe('low')
  })
})
