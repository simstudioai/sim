/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { chatUrl } from '@/app/workspace/[workspaceId]/home/hooks/chat-url'

describe('chatUrl', () => {
  it('routes organization conversations without adding a workspace or mode', () => {
    window.history.replaceState(null, '', '/o/org-1/home?mode=assistant')
    expect(chatUrl({ organizationId: 'org-1' }, 'chat-1')).toBe('/o/org-1/chat/chat-1')
  })

  it.each(['build', 'assistant', 'search', 'unknown'])(
    'preserves the resource while dropping legacy mode %s and search filters',
    (mode) => {
      window.history.replaceState(
        null,
        '',
        `/workspace/ws-1/home?mode=${mode}&q=budget&source=upload&updated=7d&resource=report`
      )
      expect(chatUrl('ws-1', 'chat-1')).toBe('/workspace/ws-1/chat/chat-1?resource=report')
    }
  )

  it('produces a clean path when no resource is selected', () => {
    window.history.replaceState(null, '', '/workspace/ws-1/home?q=budget')
    expect(chatUrl('ws-1', 'chat-1')).toBe('/workspace/ws-1/chat/chat-1')
  })
})
