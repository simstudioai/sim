/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateApiKeyFromHeader,
  mockGetSession,
  mockUpdateApiKeyLastUsed,
  mockVerifyInternalToken,
} = vi.hoisted(() => ({
  mockAuthenticateApiKeyFromHeader: vi.fn(),
  mockGetSession: vi.fn(),
  mockUpdateApiKeyLastUsed: vi.fn(),
  mockVerifyInternalToken: vi.fn(),
}))

vi.unmock('@/lib/auth/hybrid')

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: mockAuthenticateApiKeyFromHeader,
  updateApiKeyLastUsed: mockUpdateApiKeyLastUsed,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyInternalToken: mockVerifyInternalToken,
}))

import { AuthType, checkHybridAuth } from '@/lib/auth/hybrid'

function createRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/test', { headers })
}

describe('checkHybridAuth credential precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyInternalToken.mockResolvedValue({ valid: false })
    mockGetSession.mockResolvedValue({
      user: { id: 'session-user', name: 'Session User', email: 'session@example.com' },
    })
  })

  it('uses a valid explicit API key before a session cookie', async () => {
    mockAuthenticateApiKeyFromHeader.mockResolvedValue({
      success: true,
      userId: 'api-user',
      keyId: 'key-1',
      keyType: 'personal',
    })

    const result = await checkHybridAuth(
      createRequest({ cookie: 'session=value', 'x-api-key': 'valid-key' })
    )

    expect(result).toEqual({
      success: true,
      userId: 'api-user',
      workspaceId: undefined,
      authType: AuthType.API_KEY,
      apiKeyType: 'personal',
    })
    expect(mockUpdateApiKeyLastUsed).toHaveBeenCalledWith('key-1')
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it.each(['invalid-key', ''])(
    'does not fall through to a session when an explicit API key is invalid (%j)',
    async (apiKey) => {
      mockAuthenticateApiKeyFromHeader.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
      })

      const result = await checkHybridAuth(
        createRequest({ cookie: 'session=value', 'x-api-key': apiKey })
      )

      expect(result).toEqual({ success: false, error: 'Invalid API key' })
      expect(mockAuthenticateApiKeyFromHeader).toHaveBeenCalledWith(apiKey)
      expect(mockGetSession).not.toHaveBeenCalled()
    }
  )

  it('keeps a valid internal JWT ahead of both API key and session credentials', async () => {
    mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'internal-user' })
    mockAuthenticateApiKeyFromHeader.mockResolvedValue({
      success: true,
      userId: 'api-user',
      keyId: 'key-1',
      keyType: 'personal',
    })

    const result = await checkHybridAuth(
      createRequest({
        authorization: 'Bearer internal-token',
        cookie: 'session=value',
        'x-api-key': 'valid-key',
      })
    )

    expect(result).toEqual({
      success: true,
      userId: 'internal-user',
      authType: AuthType.INTERNAL_JWT,
    })
    expect(mockAuthenticateApiKeyFromHeader).not.toHaveBeenCalled()
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
