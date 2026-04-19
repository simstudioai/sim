/**
 * Tests for OAuth credentials API route
 *
 * @vitest-environment node
 */

import {
  hybridAuthMock,
  hybridAuthMockFns,
  permissionsMock,
  requestUtilsMock,
  schemaMock,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => {
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
    mockLogger: logger,
  }
})

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

vi.mock('@/lib/credentials/oauth', () => ({
  syncWorkspaceOAuthCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db/schema', () => schemaMock)

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
  })

  it('should handle unauthenticated user', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
