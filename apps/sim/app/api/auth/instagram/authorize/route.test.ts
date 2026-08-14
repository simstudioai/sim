/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
  createConnectDraft: vi.fn(),
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

vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: mocks.createConnectDraft,
}))

vi.mock('@/lib/oauth/utils', () => ({
  getCanonicalScopesForProvider: () => ['instagram_business_basic'],
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))

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
    mocks.checkWorkspaceAccess.mockResolvedValue({ canWrite: true })
    mocks.createConnectDraft.mockResolvedValue({ id: 'draft-created' })
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
    expect(mocks.checkWorkspaceAccess).not.toHaveBeenCalled()
    expect(mocks.createConnectDraft).not.toHaveBeenCalled()
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
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.createConnectDraft).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'instagram',
    })
  })
})
