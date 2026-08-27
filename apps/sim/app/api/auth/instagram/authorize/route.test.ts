/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCredentialConnection: vi.fn(),
  getSession: vi.fn(),
  requireConfiguredOAuthClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  requireConfiguredOAuthClient: mocks.requireConfiguredOAuthClient,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.test',
}))

vi.mock('@/lib/credentials/application/create-credential-connection', () => ({
  createCredentialConnection: { execute: mocks.createCredentialConnection },
}))

vi.mock('@/lib/oauth/utils', () => ({
  getCanonicalScopesForProvider: () => ['instagram_business_basic'],
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/auth/instagram/authorize/route'

describe('Instagram authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.requireConfiguredOAuthClient.mockReturnValue({
      values: { INSTAGRAM_CLIENT_ID: 'instagram-client' },
    })
    mocks.createCredentialConnection.mockResolvedValue({ draftId: 'draft-created' })
  })

  it('preserves an exact credential draft when workspaceId is also supplied', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/instagram/authorize?workspaceId=workspace-1&draftId=draft-exact'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('set-cookie')).toContain(
      'instagram_credential_draft_id=draft-exact'
    )
    expect(mocks.createCredentialConnection).not.toHaveBeenCalled()
  })

  it('creates a credential draft for a legacy workspace-only launch', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/instagram/authorize?workspaceId=workspace-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('set-cookie')).toContain(
      'instagram_credential_draft_id=draft-created'
    )
    expect(response.headers.get('set-cookie')).toContain('Max-Age=900')
    expect(mocks.createCredentialConnection).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', providerId: 'instagram' },
      request,
    })
  })

  it('returns a conflict when a different connection intent is already active', async () => {
    mocks.createCredentialConnection.mockRejectedValue(
      new OrchestrationError(
        'conflict',
        'A different OAuth connection flow is already active for this provider'
      )
    )
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/instagram/authorize?workspaceId=workspace-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A different OAuth connection flow is already active for this provider',
    })
  })
})
