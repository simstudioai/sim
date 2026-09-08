/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { chatUrl } from '@/app/workspace/[workspaceId]/home/hooks/chat-url'

function withSearch(search: string) {
  window.history.replaceState(null, '', `/workspace/ws-1/home${search}`)
}

describe('chatUrl', () => {
  it('routes organization conversations to their owner without inventing a workspace', () => {
    window.history.replaceState(null, '', '/o/org-1/home')
    expect(chatUrl({ organizationId: 'org-1' }, 'chat-1', 'assistant')).toBe(
      '/o/org-1/chat/chat-1?mode=assistant'
    )
  })

  it('carries the mode and the open resource onto the chat path', () => {
    withSearch('?mode=assistant&resource=res-1')
    expect(chatUrl('ws-1', 'chat-1')).toBe(
      '/workspace/ws-1/chat/chat-1?mode=assistant&resource=res-1'
    )
  })

  it('leaves a search query and its filters behind', () => {
    withSearch('?q=volvo&source=gmail&updated=7d&mode=assistant')
    expect(chatUrl('ws-1', 'chat-1')).toBe('/workspace/ws-1/chat/chat-1?mode=assistant')
  })

  it('produces a clean path when nothing belongs on the chat', () => {
    withSearch('?q=volvo')
    expect(chatUrl('ws-1', 'chat-1')).toBe('/workspace/ws-1/chat/chat-1')
  })

  it('uses the submitted mode only when no view has been selected', () => {
    withSearch('')
    expect(chatUrl('ws-1', 'chat-1', 'assistant')).toBe(
      '/workspace/ws-1/chat/chat-1?mode=assistant'
    )
    expect(chatUrl('ws-1', 'chat-1', 'agent')).toBe('/workspace/ws-1/chat/chat-1?mode=build')
  })

  it.each([
    ['?mode=build', 'assistant', '?mode=build'],
    ['?mode=assistant', 'agent', '?mode=assistant'],
    [
      '?mode=search&q=budget&source=upload&updated=7d',
      'assistant',
      '?mode=search&q=budget&source=upload&updated=7d',
    ],
  ] as const)('preserves a mode selected after submission: %s', (current, submitted, expected) => {
    withSearch(current)
    expect(chatUrl('ws-1', 'chat-1', submitted)).toBe(`/workspace/ws-1/chat/chat-1${expected}`)
  })
})
