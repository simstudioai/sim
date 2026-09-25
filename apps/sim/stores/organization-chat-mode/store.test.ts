/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { useOrganizationChatModeStore } from '@/stores/organization-chat-mode/store'

beforeEach(() => {
  localStorage.clear()
  useOrganizationChatModeStore.setState({ modes: {}, assistantSearchLevels: {} })
})

describe('organization Search preferences', () => {
  it('migrates old Fast choices without losing mode or user/org isolation', async () => {
    localStorage.setItem(
      'organization-chat-mode',
      JSON.stringify({
        version: 0,
        state: {
          modes: { 'a:org': 'assistant', 'b:org': 'agent' },
          assistantFast: { 'a:org': true, 'b:org': false },
        },
      })
    )
    await useOrganizationChatModeStore.persist.rehydrate()
    expect(useOrganizationChatModeStore.getState().modes).toEqual({
      'a:org': 'assistant',
      'b:org': 'agent',
    })
    expect(useOrganizationChatModeStore.getState().assistantSearchLevels).toEqual({
      'a:org': 'fast',
      'b:org': 'adaptive',
    })
    expect(JSON.parse(localStorage.getItem('organization-chat-mode')!).state).not.toHaveProperty(
      'assistantFast'
    )
  })

  it('persists all search levels independently from Build mode', async () => {
    for (const level of ['fast', 'adaptive', 'max'] as const) {
      useOrganizationChatModeStore.getState().setAssistantSearchLevel('user', level, level)
    }
    useOrganizationChatModeStore.getState().setMode('user', 'max', 'agent')
    const persisted = localStorage.getItem('organization-chat-mode')!
    useOrganizationChatModeStore.setState({ modes: {}, assistantSearchLevels: {} })
    localStorage.setItem('organization-chat-mode', persisted)
    await useOrganizationChatModeStore.persist.rehydrate()
    expect(useOrganizationChatModeStore.getState().assistantSearchLevels).toEqual({
      'user:fast': 'fast',
      'user:adaptive': 'adaptive',
      'user:max': 'max',
    })
    expect(useOrganizationChatModeStore.getState().modes['user:max']).toBe('agent')
  })
})

it('migrates saved None to Auto while preserving assistant levels and modes', async () => {
  localStorage.setItem(
    'organization-chat-mode',
    JSON.stringify({
      version: 1,
      state: {
        modes: { 'a:org': 'assistant', 'b:org': 'agent' },
        assistantSearchLevels: {
          'a:org': 'none',
          'b:org': 'max',
          'c:org': 'fast',
          'd:org': 'adaptive',
        },
      },
    })
  )
  await useOrganizationChatModeStore.persist.rehydrate()
  expect(useOrganizationChatModeStore.getState().assistantSearchLevels).toEqual({
    'a:org': 'adaptive',
    'b:org': 'max',
    'c:org': 'fast',
    'd:org': 'adaptive',
  })
  expect(useOrganizationChatModeStore.getState().modes).toEqual({
    'a:org': 'assistant',
    'b:org': 'agent',
  })
})
