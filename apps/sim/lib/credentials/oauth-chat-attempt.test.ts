/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  addOAuthChatAttemptToAuthorizeUrl,
  createOAuthChatAttempt,
  getOAuthCredentialBaseline,
  hasOAuthCredentialChanged,
  OAUTH_CHAT_ATTEMPT_EVENT,
  OAUTH_CHAT_ATTEMPT_PARAM,
  readLatestOAuthChatAttempt,
  resolveActiveDesktopOAuthChatAttempt,
  setActiveDesktopOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'

describe('OAuth chat attempts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/workspace/workspace-1/chat/chat-1')
  })

  it('carries the attempt through a generic OAuth callback URL', () => {
    const authorizeUrl = addOAuthChatAttemptToAuthorizeUrl(
      'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
      'attempt-1'
    )

    const callbackUrl = new URL(new URL(authorizeUrl).searchParams.get('callbackURL') ?? '')
    expect(callbackUrl.searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)).toBe('attempt-1')
  })

  it.each(['instagram', 'shopify', 'trello'])(
    'carries the attempt through the %s return URL',
    (provider) => {
      const authorizeUrl = addOAuthChatAttemptToAuthorizeUrl(
        `https://sim.test/api/auth/${provider}/authorize?returnUrl=${encodeURIComponent('https://sim.test/workspace/workspace-1/chat/chat-1')}`,
        'attempt-2'
      )

      const returnUrl = new URL(new URL(authorizeUrl).searchParams.get('returnUrl') ?? '')
      expect(returnUrl.searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)).toBe('attempt-2')
    }
  )

  it('publishes and persists server-verified completion', () => {
    let publishedStatus: string | undefined
    window.addEventListener(
      OAUTH_CHAT_ATTEMPT_EVENT,
      ((event: CustomEvent) => {
        publishedStatus = event.detail.status
      }) as EventListener,
      { once: true }
    )

    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'message-1:0:0',
      baselineCredentialIds: [],
    })
    expect(publishedStatus).toBe('pending')

    setOAuthChatAttemptStatus(attempt.id, 'connected')
    expect(
      readLatestOAuthChatAttempt({
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        controlId: 'message-1:0:0',
      })?.status
    ).toBe('connected')
  })

  it('resolves only the active desktop attempt', () => {
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'slack',
      baseProviderId: 'slack',
      displayName: 'Slack',
      controlId: 'message-1:0:0',
      baselineCredentialIds: [],
    })
    setActiveDesktopOAuthChatAttempt(attempt.id)

    expect(resolveActiveDesktopOAuthChatAttempt('connected')?.id).toBe(attempt.id)
    expect(resolveActiveDesktopOAuthChatAttempt('connected')).toBeNull()
  })

  it('requires a new matching credential instead of accepting an existing one', () => {
    const before = [
      { id: 'existing-gmail', providerId: 'google', updatedAt: '2026-08-07T10:00:00Z' },
    ]
    const target = {
      providerId: 'google-email',
      baseProviderId: 'google',
    }
    const baseline = getOAuthCredentialBaseline(target, before)

    expect(hasOAuthCredentialChanged({ ...target, ...baseline }, before)).toBe(false)
    expect(
      hasOAuthCredentialChanged({ ...target, ...baseline }, [
        ...before,
        { id: 'new-gmail', providerId: 'google', updatedAt: '2026-08-07T10:05:00Z' },
      ])
    ).toBe(true)
    expect(
      hasOAuthCredentialChanged({ ...target, ...baseline }, [
        ...before,
        { id: 'new-slack', providerId: 'slack', updatedAt: '2026-08-07T10:05:00Z' },
      ])
    ).toBe(false)
  })

  it('requires the target credential to change for reconnect', () => {
    const before = [{ id: 'gmail-1', providerId: 'google', updatedAt: '2026-08-07T10:00:00Z' }]
    const target = {
      providerId: 'google-email',
      baseProviderId: 'google',
      credentialId: 'gmail-1',
    }
    const baseline = getOAuthCredentialBaseline(target, before)

    expect(hasOAuthCredentialChanged({ ...target, ...baseline }, before)).toBe(false)
    expect(
      hasOAuthCredentialChanged({ ...target, ...baseline }, [
        { ...before[0], updatedAt: '2026-08-07T10:05:00Z' },
      ])
    ).toBe(true)
  })
})
