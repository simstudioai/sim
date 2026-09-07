/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_DRAFT_TTL_MS } from '@/lib/credentials/draft-constants'
import { createQuickBooksOAuthState, parseQuickBooksOAuthState } from '@/lib/oauth/quickbooks-state'

const USER_ID = 'user-1'

describe('QuickBooks OAuth state', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps overlapping drafts bound to their own return destinations', () => {
    const first = createQuickBooksOAuthState({
      userId: USER_ID,
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=first',
    })
    const second = createQuickBooksOAuthState({
      userId: USER_ID,
      draftId: 'draft-2',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=second',
    })

    expect(parseQuickBooksOAuthState({ state: first, userId: USER_ID })).toEqual({
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=first',
    })
    expect(parseQuickBooksOAuthState({ state: second, userId: USER_ID })).toEqual({
      draftId: 'draft-2',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=second',
    })
  })

  it('rejects tampering, cross-user reuse, and expired state', () => {
    const issuedAt = new Date('2026-09-04T18:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt.getTime())
    const state = createQuickBooksOAuthState({
      userId: USER_ID,
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected',
    })
    const [payload, signature] = state.split('.')

    expect(() =>
      parseQuickBooksOAuthState({ state: `${payload}x.${signature}`, userId: USER_ID })
    ).toThrow('QuickBooks OAuth state signature is invalid')
    expect(() => parseQuickBooksOAuthState({ state, userId: 'user-2', now: issuedAt })).toThrow(
      'QuickBooks OAuth state belongs to a different user'
    )
    expect(
      parseQuickBooksOAuthState({
        state,
        userId: USER_ID,
        now: new Date(issuedAt.getTime() + CREDENTIAL_DRAFT_TTL_MS),
      })
    ).toEqual({
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected',
    })
    expect(() =>
      parseQuickBooksOAuthState({
        state,
        userId: USER_ID,
        now: new Date(issuedAt.getTime() + CREDENTIAL_DRAFT_TTL_MS + 1),
      })
    ).toThrow('QuickBooks OAuth state is expired')
  })
})
