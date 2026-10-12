/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatPanelStore } from '@/stores/chat-panel/store'

describe('chat identity adoption during a resize', () => {
  beforeEach(() => {
    useChatPanelStore.getState().reset()
  })

  it.each([undefined, 600])(
    'lands a late gesture on the assigned chat (previous width: %s)',
    (initialWidth) => {
      const store = useChatPanelStore.getState()
      if (initialWidth !== undefined) store.setWidth('user-a', 'pending:chat', initialWidth)
      store.migrate('pending:chat', 'chat-a')
      store.setWidth('user-a', 'pending:chat', 700)
      expect(useChatPanelStore.getState().widths).toEqual({ 'user-a:chat-a': 700 })
    }
  )
})

describe('cold chat panel preferences', () => {
  it.each(['migrate', 'resize'] as const)(
    'preserves saved chats when %s precedes panel attachment',
    async (action) => {
      vi.resetModules()
      localStorage.setItem(
        'chat-panel-widths',
        JSON.stringify({ state: { widths: { 'user-a:existing-chat': 720 } }, version: 0 })
      )
      const { useChatPanelStore: coldStore } = await import('@/stores/chat-panel/store')
      if (action === 'migrate') coldStore.getState().migrate('pending:chat', 'chat-a')
      else coldStore.getState().setWidth('user-a', 'chat-a', 700)
      expect(coldStore.getState().widths['user-a:existing-chat']).toBe(720)
      expect(
        JSON.parse(localStorage.getItem('chat-panel-widths')!).state.widths['user-a:existing-chat']
      ).toBe(720)
    }
  )
})
