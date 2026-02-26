/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockEvaluateScopeCoverage, mockLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockEvaluateScopeCoverage: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/oauth', () => ({
  evaluateScopeCoverage: mockEvaluateScopeCoverage,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('mock-request-id'),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    userId: 'userId',
    providerId: 'providerId',
    id: 'id',
    scope: 'scope',
    updatedAt: 'updatedAt',
  },
  credential: {
    id: 'id',
    workspaceId: 'workspaceId',
    type: 'type',
    displayName: 'displayName',
    providerId: 'providerId',
    accountId: 'accountId',
  },
  credentialMember: {
    id: 'id',
    credentialId: 'credentialId',
    userId: 'userId',
    status: 'status',
  },
  user: { email: 'email', id: 'id' },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

import { GET } from '@/app/api/auth/oauth/credentials/route'

describe('OAuth Credentials API Route', () => {
  function createMockRequestWithQuery(method = 'GET', queryParams = ''): NextRequest {
    const url = `http://localhost:3000/api/auth/oauth/credentials${queryParams}`
    return new NextRequest(new URL(url), { method })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockEvaluateScopeCoverage.mockImplementation(
      (_providerId: string, grantedScopes: string[]) => ({
        canonicalScopes: grantedScopes,
        grantedScopes,
        missingScopes: [],
        extraScopes: [],
        requiresReauthorization: false,
      })
    )
  })

  it('should handle unauthenticated user', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('User not authenticated')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle missing provider parameter', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Provider or credentialId is required')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle no credentials found', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=github')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })

  it('should return empty credentials when no workspace context', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })

    const req = createMockRequestWithQuery('GET', '?provider=google-email')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.credentials).toHaveLength(0)
  })
})
