/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://sim.test/workspace/workspace-1/chat/chat-1" }
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  addOAuthChatAttemptToAuthorizeUrl,
  buildOAuthChatCompleteAuthorizeUrl,
  createOAuthChatAttempt,
  getOAuthCredentialBaseline,
  hasOAuthCredentialChanged,
  hasOAuthCredentialForTarget,
  OAUTH_CHAT_ATTEMPT_EVENT,
  OAUTH_CHAT_ATTEMPT_PARAM,
  OAUTH_CHAT_COMPLETE_PATH,
  OAUTH_CHAT_RETURN_TO_PARAM,
  readLatestOAuthChatAttempt,
  readOAuthChatAttempt,
  resolveActiveDesktopOAuthChatAttempt,
  resolveDesktopOAuthChatAttempt,
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

  it('routes the return through the chat-complete page', () => {
    const authorizeUrl = buildOAuthChatCompleteAuthorizeUrl(
      'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
      'attempt-1'
    )

    const callbackUrl = new URL(new URL(authorizeUrl ?? '').searchParams.get('callbackURL') ?? '')
    expect(callbackUrl.pathname).toBe(OAUTH_CHAT_COMPLETE_PATH)
    expect(callbackUrl.searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)).toBe('attempt-1')
    // Anchored on the server-generated return URL's origin, not this tab's —
    // a proxied deployment's two origins need not agree.
    expect(callbackUrl.origin).toBe('https://sim.test')
  })

  it('refuses a cross-origin authorize URL so the attempt id never leaves the app', () => {
    expect(
      buildOAuthChatCompleteAuthorizeUrl(
        'https://evil.example/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fevil.example%2Fsink',
        'attempt-1'
      )
    ).toBeNull()
  })

  it('leaves the attempt off the close-fallback target so it is not re-decided', () => {
    const authorizeUrl = buildOAuthChatCompleteAuthorizeUrl(
      'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
      'attempt-1'
    )

    const callbackUrl = new URL(new URL(authorizeUrl ?? '').searchParams.get('callbackURL') ?? '')
    const returnTo = new URL(callbackUrl.searchParams.get(OAUTH_CHAT_RETURN_TO_PARAM) ?? '')
    expect(returnTo.pathname).toBe('/workspace/workspace-1/chat/chat-1')
    expect(returnTo.searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)).toBeNull()
  })

  it.each(['instagram', 'shopify', 'trello'])(
    'routes the %s return through the chat-complete page',
    (provider) => {
      const authorizeUrl = buildOAuthChatCompleteAuthorizeUrl(
        `https://sim.test/api/auth/${provider}/authorize?returnUrl=${encodeURIComponent('https://sim.test/workspace/workspace-1/chat/chat-1')}`,
        'attempt-2'
      )

      const returnUrl = new URL(new URL(authorizeUrl ?? '').searchParams.get('returnUrl') ?? '')
      expect(returnUrl.pathname).toBe(OAUTH_CHAT_COMPLETE_PATH)
      expect(returnUrl.searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)).toBe('attempt-2')
    }
  )

  it('declines a chat-complete URL when there is no return param to rewrite', () => {
    expect(
      buildOAuthChatCompleteAuthorizeUrl(
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
        'attempt-3'
      )
    ).toBeNull()
  })

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

  it('resolves the exact correlated desktop attempt without consuming a sibling', () => {
    const first = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'slack',
      baseProviderId: 'slack',
      displayName: 'Slack',
      controlId: 'message-1:0:0',
      baselineCredentialIds: [],
    })
    const second = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'message-1:0:1',
      baselineCredentialIds: [],
    })
    setActiveDesktopOAuthChatAttempt(second.id)

    expect(resolveDesktopOAuthChatAttempt({ chatAttemptId: first.id }, 'connected')?.id).toBe(
      first.id
    )
    expect(readOAuthChatAttempt(first.id)?.status).toBe('connected')
    expect(readOAuthChatAttempt(second.id)?.status).toBe('pending')
    expect(resolveActiveDesktopOAuthChatAttempt('failed')?.id).toBe(second.id)
  })

  it('does not consume a chat attempt for a correlated ordinary desktop flow', () => {
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'slack',
      baseProviderId: 'slack',
      displayName: 'Slack',
      controlId: 'message-1:0:0',
      baselineCredentialIds: [],
    })
    setActiveDesktopOAuthChatAttempt(attempt.id)

    expect(resolveDesktopOAuthChatAttempt({ chatAttemptId: null }, 'connected')).toBeNull()
    expect(readOAuthChatAttempt(attempt.id)?.status).toBe('pending')
    expect(resolveActiveDesktopOAuthChatAttempt('connected')?.id).toBe(attempt.id)
  })

  it('falls back to the active attempt for an older desktop completion payload', () => {
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'slack',
      baseProviderId: 'slack',
      displayName: 'Slack',
      controlId: 'message-1:0:0',
      baselineCredentialIds: [],
    })
    setActiveDesktopOAuthChatAttempt(attempt.id)

    expect(resolveDesktopOAuthChatAttempt({}, 'connected')?.id).toBe(attempt.id)
    expect(readOAuthChatAttempt(attempt.id)?.status).toBe('connected')
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

describe('credential matching for a chat chip', () => {
  const credential = (providerId: string) => ({
    id: `cred-${providerId}`,
    providerId,
    updatedAt: '2026-08-11T00:00:00.000Z',
  })

  it('matches a credential from an alternate authorization server', () => {
    // A sandbox-only user is connected; without this the chip reads as
    // disconnected and re-prompts them to connect Salesforce again.
    expect(
      hasOAuthCredentialForTarget(
        {
          providerId: 'salesforce',
          baseProviderId: 'salesforce',
          additionalProviderIds: ['salesforce-sandbox'],
        },
        [credential('salesforce-sandbox')]
      )
    ).toBe(true)
  })

  it('still matches the primary id and the base provider', () => {
    const target = { providerId: 'google-email', baseProviderId: 'google' }
    expect(hasOAuthCredentialForTarget(target, [credential('google-email')])).toBe(true)
    expect(hasOAuthCredentialForTarget(target, [credential('google')])).toBe(true)
  })

  it('does not match an unrelated provider', () => {
    expect(
      hasOAuthCredentialForTarget(
        {
          providerId: 'salesforce',
          baseProviderId: 'salesforce',
          additionalProviderIds: ['salesforce-sandbox'],
        },
        [credential('hubspot')]
      )
    ).toBe(false)
  })

  it('honours an explicit credentialId over any provider match', () => {
    expect(
      hasOAuthCredentialForTarget(
        {
          providerId: 'salesforce',
          baseProviderId: 'salesforce',
          credentialId: 'cred-other',
          additionalProviderIds: ['salesforce-sandbox'],
        },
        [credential('salesforce-sandbox')]
      )
    ).toBe(false)
  })
})

describe('attempt carries the alternate provider ids through verification', () => {
  it('lets hasOAuthCredentialChanged see a credential from an alternate server', () => {
    // The post-connect leg re-reads the STORED attempt, not the live target, so
    // the ids must survive the round trip or a sandbox connect reads as failed.
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'salesforce',
      baseProviderId: 'salesforce',
      additionalProviderIds: ['salesforce-sandbox'],
      displayName: 'Salesforce',
      controlId: 'control-1',
      baselineCredentialIds: [],
    })

    const stored = readOAuthChatAttempt(attempt.id)
    expect(stored?.additionalProviderIds).toEqual(['salesforce-sandbox'])

    expect(
      hasOAuthCredentialChanged(stored as NonNullable<typeof stored>, [
        {
          id: 'cred-sandbox',
          providerId: 'salesforce-sandbox',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      ])
    ).toBe(true)
  })
})
