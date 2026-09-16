/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOAuthChatAttempt,
  type OAuthChatAttempt,
  readOAuthChatAttempt,
} from '@/lib/credentials/oauth-chat-attempt'
import { ChatCompleteHandoff } from '@/app/oauth/chat-complete/chat-complete-handoff'

function renderAt(search: string): { root: Root } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', `/oauth/chat-complete${search}`)
  const root: Root = createRoot(document.createElement('div'))
  act(() => root.render(<ChatCompleteHandoff />))
  return { root }
}

describe('ChatCompleteHandoff', () => {
  let attempt: OAuthChatAttempt

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.spyOn(window, 'close').mockImplementation(() => {})
    attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'message-1:0:0',
      baselineCredentialIds: ['existing-gmail'],
    })
  })

  it('publishes success on arrival, without requiring a new credential to appear', () => {
    // Re-authorizing an already-linked account updates the account row rather
    // than creating one, so no new credential lands — reaching this page is
    // still the server telling us the flow succeeded.
    const { root } = renderAt(`?oauthAttempt=${attempt.id}`)

    expect(readOAuthChatAttempt(attempt.id)?.status).toBe('connected')
    expect(window.close).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it('publishes failure when the provider returned an error', () => {
    const { root } = renderAt(`?oauthAttempt=${attempt.id}&error=access_denied`)

    expect(readOAuthChatAttempt(attempt.id)?.status).toBe('failed')
    act(() => root.unmount())
  })

  it('leaves an unrelated attempt untouched when no attempt is named', () => {
    const { root } = renderAt('')

    expect(readOAuthChatAttempt(attempt.id)?.status).toBe('pending')
    expect(window.close).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it('still publishes the verdict when the attempt store rejects the write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    // The verdict is lost, but the window must still be released — an
    // unguarded throw would strand the popup open on this page.
    expect(() => renderAt(`?oauthAttempt=${attempt.id}`)).not.toThrow()
    expect(window.close).toHaveBeenCalledOnce()
    setItem.mockRestore()
  })

  describe('close-refused fallback', () => {
    const realLocation = window.location

    afterEach(() => {
      vi.useRealTimers()
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    })

    /**
     * jsdom performs no navigation and forbids redefining `location.replace`,
     * so the whole location is swapped for a stub carrying only what the
     * handoff reads: the current href, the origin, and the redirect sink.
     */
    function renderWithStubbedLocation(search: string): { calls: string[]; root: Root } {
      const calls: string[] = []
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          href: `https://sim.test/oauth/chat-complete${search}`,
          origin: 'https://sim.test',
          replace: (url: string) => calls.push(url),
        },
      })
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      const root: Root = createRoot(document.createElement('div'))
      act(() => root.render(<ChatCompleteHandoff />))
      return { calls, root }
    }

    it('redirects to a same-origin returnTo once the close is refused', () => {
      vi.useFakeTimers()
      const returnTo = 'https://sim.test/workspace/workspace-1/chat/chat-1'

      const { calls, root } = renderWithStubbedLocation(
        `?oauthAttempt=${attempt.id}&returnTo=${encodeURIComponent(returnTo)}`
      )
      act(() => {
        vi.advanceTimersByTime(400)
      })

      expect(calls).toEqual([returnTo])
      act(() => root.unmount())
    })

    it('refuses a cross-origin returnTo and falls back to the workspace', () => {
      vi.useFakeTimers()

      const { calls, root } = renderWithStubbedLocation(
        `?oauthAttempt=${attempt.id}&returnTo=${encodeURIComponent('https://evil.example/steal')}`
      )
      act(() => {
        vi.advanceTimersByTime(400)
      })

      expect(calls).toEqual(['/home'])
      act(() => root.unmount())
    })
  })
})
