/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://sim.test/workspace/workspace-1/chat/chat-1" }
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { OAuthChatAttempt, OAuthChatAttemptStatus } from '@/lib/credentials/oauth-chat-attempt'
import {
  addOAuthChatAttemptToAuthorizeUrl,
  buildOAuthChatCompleteAuthorizeUrl,
  createOAuthChatAttempt,
  getOAuthCredentialBaseline,
  hasOAuthCredentialChanged,
  OAUTH_CHAT_ATTEMPT_EVENT,
  OAUTH_CHAT_ATTEMPT_MAX_AGE_MS,
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

  const SWEEP_INPUT = {
    workspaceId: 'workspace-1',
    providerId: 'slack',
    baseProviderId: 'slack',
    displayName: 'Slack',
    controlId: 'message-1:0:0',
    baselineCredentialIds: [],
  }
  const SWEEP_LATEST_KEY = 'sim.oauth-chat-latest.workspace-1.slack.message-1%3A0%3A0.'
  const RETENTION_MS = 24 * 60 * 60 * 1000

  /** Storage is index-addressed and its keys are not own-enumerable in jsdom. */
  function storageKeysWithPrefix(prefix: string): string[] {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    return keys.sort()
  }

  /** Backdates a stored attempt, then starts an unrelated one to trigger the sweep. */
  function ageAttemptThenSweep(
    attempt: OAuthChatAttempt,
    ageMs: number,
    status: OAuthChatAttemptStatus
  ): void {
    window.localStorage.setItem(
      `sim.oauth-chat-attempt.${attempt.id}`,
      JSON.stringify({ ...attempt, requestedAt: attempt.requestedAt - ageMs, status })
    )
    createOAuthChatAttempt({ ...SWEEP_INPUT, controlId: 'message-1:9:9' })
  }

  it('sweeps resolved attempts and their latest-pointers past the retention window', () => {
    const stale = createOAuthChatAttempt(SWEEP_INPUT)
    expect(window.localStorage.getItem(SWEEP_LATEST_KEY)).toBe(stale.id)

    ageAttemptThenSweep(stale, RETENTION_MS + 1, 'connected')

    expect(window.localStorage.getItem(`sim.oauth-chat-attempt.${stale.id}`)).toBeNull()
    expect(window.localStorage.getItem(SWEEP_LATEST_KEY)).toBeNull()
  })

  it('keeps a resolved attempt a mounted row still reads past the lookup cutoff', () => {
    const settled = createOAuthChatAttempt(SWEEP_INPUT)

    ageAttemptThenSweep(settled, OAUTH_CHAT_ATTEMPT_MAX_AGE_MS + 1, 'connected')

    // A chip recomputes itself from storage on every attempt event, and on the
    // reconnect path the record is its only source of connected state — so
    // sweeping at the lookup cutoff would revert a row that is still on screen.
    expect(readOAuthChatAttempt(settled.id)?.status).toBe('connected')
  })

  it('keeps a pending attempt past the read cutoff so a late verdict still lands', () => {
    const parked = createOAuthChatAttempt(SWEEP_INPUT)

    ageAttemptThenSweep(parked, OAUTH_CHAT_ATTEMPT_MAX_AGE_MS + 1, 'pending')

    // The read cutoff already hides it from the latest-pointer lookup, but the
    // record itself must survive: a popup parked this long can still return.
    expect(readLatestOAuthChatAttempt(SWEEP_INPUT)).toBeNull()
    expect(setOAuthChatAttemptStatus(parked.id, 'connected')?.status).toBe('connected')
  })

  it('keeps a late verdict alive after it lands on a long-parked attempt', () => {
    const parked = createOAuthChatAttempt(SWEEP_INPUT)
    ageAttemptThenSweep(parked, OAUTH_CHAT_ATTEMPT_MAX_AGE_MS + 1, 'pending')

    // The verdict arrives long after the request, so the record is only young
    // by resolution. Aging it from requestedAt would make it sweepable at once.
    expect(setOAuthChatAttemptStatus(parked.id, 'connected')?.status).toBe('connected')
    createOAuthChatAttempt({ ...SWEEP_INPUT, controlId: 'message-1:8:8' })

    expect(readOAuthChatAttempt(parked.id)?.status).toBe('connected')
  })

  it('sweeps many adjacent stale records in one pass', () => {
    const template = createOAuthChatAttempt(SWEEP_INPUT)
    const staleIds = [0, 1, 2, 3, 4, 5].map((slot) => `stale-attempt-${slot}`)
    // Written directly, so the records land in consecutive storage slots with
    // no latest-pointer between them — interleaved keys would mask the skip.
    for (const staleId of staleIds) {
      window.localStorage.setItem(
        `sim.oauth-chat-attempt.${staleId}`,
        JSON.stringify({
          ...template,
          id: staleId,
          status: 'connected',
          resolvedAt: template.requestedAt - RETENTION_MS - 1,
        })
      )
    }

    createOAuthChatAttempt({ ...SWEEP_INPUT, controlId: 'message-1:9:9' })

    // Removing entries mid-scan would shift every later key down a slot and
    // skip the next one, leaving about half of these behind.
    expect(storageKeysWithPrefix('sim.oauth-chat-attempt.stale-attempt-')).toEqual([])
  })

  it('sweeps a pending attempt once it is past the retention window', () => {
    const abandoned = createOAuthChatAttempt(SWEEP_INPUT)

    ageAttemptThenSweep(abandoned, RETENTION_MS + 1, 'pending')

    expect(window.localStorage.getItem(`sim.oauth-chat-attempt.${abandoned.id}`)).toBeNull()
    expect(window.localStorage.getItem(SWEEP_LATEST_KEY)).toBeNull()
  })

  it('keeps unexpired attempts across a sweep', () => {
    const live = createOAuthChatAttempt(SWEEP_INPUT)

    createOAuthChatAttempt({ ...SWEEP_INPUT, controlId: 'message-1:9:9' })

    expect(readOAuthChatAttempt(live.id)?.id).toBe(live.id)
    expect(window.localStorage.getItem(SWEEP_LATEST_KEY)).toBe(live.id)
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
