/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCompleteQuickBooksConnection, mockGetSession } = vi.hoisted(() => ({
  mockCompleteQuickBooksConnection: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/lib/credentials/application/complete-quickbooks-connection', () => ({
  completeQuickBooksConnection: { execute: mockCompleteQuickBooksConnection },
}))

import { createQuickBooksOAuthState } from '@/lib/oauth/quickbooks-state'
import { GET } from '@/app/api/auth/oauth2/callback/quickbooks/route'

function callbackRequest(searchParams: URLSearchParams) {
  return createMockRequest(
    'GET',
    undefined,
    undefined,
    `https://sim.test/api/auth/oauth2/callback/quickbooks?${searchParams.toString()}`
  )
}

describe('QuickBooks OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockCompleteQuickBooksConnection.mockResolvedValue({
      accountId: 'account-1',
      environment: 'sandbox',
      realmId: '1234567890',
    })
  })

  it('binds the provider callback to the signed draft and callback-derived realm', async () => {
    const state = createQuickBooksOAuthState({
      userId: 'user-1',
      draftId: 'draft-from-state',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=quickbooks',
    })
    const response = await GET(
      callbackRequest(
        new URLSearchParams({
          code: 'authorization-code',
          state,
          realmId: ' 1234567890 ',
          locale: 'en-US',
        })
      )
    )

    expect(mockCompleteQuickBooksConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
        input: expect.objectContaining({
          draftId: 'draft-from-state',
          code: 'authorization-code',
          realmId: '1234567890',
          redirectUri: 'https://sim.test/api/auth/oauth2/callback/quickbooks',
        }),
      })
    )
    expect(response.headers.get('location')).toBe(
      'https://sim.test/oauth/credential-connected?flow=quickbooks&quickbooks_connected=true'
    )
  })

  it('returns a provider-denial result without exchanging a code', async () => {
    const state = createQuickBooksOAuthState({
      userId: 'user-1',
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected',
    })
    const response = await GET(
      callbackRequest(
        new URLSearchParams({
          state,
          error: 'access_denied',
          error_description: 'The user denied access',
        })
      )
    )

    expect(mockCompleteQuickBooksConnection).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe(
      'https://sim.test/oauth/credential-connected?error=quickbooks_access_denied'
    )
  })

  it('returns completion failures to the signed initiating surface', async () => {
    mockCompleteQuickBooksConnection.mockRejectedValueOnce(new Error('Token exchange failed'))
    const state = createQuickBooksOAuthState({
      userId: 'user-1',
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/desktop/connect/complete?state=handoff',
    })
    const response = await GET(
      callbackRequest(
        new URLSearchParams({
          code: 'authorization-code',
          state,
          realmId: '1234567890',
        })
      )
    )

    expect(response.headers.get('location')).toBe(
      'https://sim.test/desktop/connect/complete?state=handoff&error=quickbooks_callback_error'
    )
  })

  it('rejects signed cross-origin return destinations', async () => {
    const state = createQuickBooksOAuthState({
      userId: 'user-1',
      draftId: 'draft-1',
      returnUrl: 'https://attacker.example/capture',
    })
    const response = await GET(
      callbackRequest(
        new URLSearchParams({
          code: 'authorization-code',
          state,
          realmId: '1234567890',
        })
      )
    )

    expect(mockCompleteQuickBooksConnection).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe(
      'https://sim.test/home?error=quickbooks_callback_error'
    )
  })
})
