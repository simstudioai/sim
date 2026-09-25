import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  updateLastUsed: vi.fn(),
}))

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: mocks.authenticateApiKey,
  updateApiKeyLastUsed: mocks.updateLastUsed,
}))

import { authenticateV1Request } from '@/app/api/v1/auth'

describe('v1 API key authentication', () => {
  it('constructs a personal API-key Principal from canonical key identity', async () => {
    mocks.authenticateApiKey.mockResolvedValue({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
    })

    await expect(
      authenticateV1Request(
        createMockRequest({
          url: 'http://localhost/api/v1/files',
          headers: { 'x-api-key': 'secret' },
        })
      )
    ).resolves.toMatchObject({
      authenticated: true,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    })
  })

  it('constructs a workspace API-key Principal without borrowing the creator identity', async () => {
    mocks.authenticateApiKey.mockResolvedValue({
      success: true,
      userId: 'creator-1',
      keyId: 'key-1',
      keyType: 'workspace',
      workspaceId: 'workspace-1',
    })

    const result = await authenticateV1Request(
      createMockRequest({
        url: 'http://localhost/api/v1/files',
        headers: { 'x-api-key': 'secret' },
      })
    )

    expect(result.principal).toEqual(createWorkspaceApiKeyPrincipal())
    expect(result.principal).not.toHaveProperty('userId')
  })

  it('fails closed when authenticated key identity is incomplete', async () => {
    mocks.authenticateApiKey.mockResolvedValue({
      success: true,
      userId: 'creator-1',
      keyId: 'key-1',
      keyType: 'workspace',
    })

    await expect(
      authenticateV1Request(
        createMockRequest({
          url: 'http://localhost/api/v1/files',
          headers: { 'x-api-key': 'secret' },
        })
      )
    ).resolves.toEqual({ authenticated: false, error: 'Authentication failed' })
    expect(mocks.updateLastUsed).not.toHaveBeenCalled()
  })
})
