/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  updateLastUsed: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isAuthDisabled: false }))
vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: mocks.authenticateApiKey,
  updateApiKeyLastUsed: mocks.updateLastUsed,
}))

import { authenticateV1Request } from '@/app/api/v1/auth'

describe('v1 API key authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs a personal API-key Principal from canonical key identity', async () => {
    mocks.authenticateApiKey.mockResolvedValue({
      success: true,
      userId: 'user-1',
      keyId: 'key-1',
      keyType: 'personal',
    })

    await expect(
      authenticateV1Request(
        new NextRequest('http://localhost/api/v1/files', {
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
      new NextRequest('http://localhost/api/v1/files', {
        headers: { 'x-api-key': 'secret' },
      })
    )

    expect(result.principal).toEqual({
      kind: 'workspace_api_key',
      workspaceId: 'workspace-1',
      keyId: 'key-1',
    })
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
        new NextRequest('http://localhost/api/v1/files', {
          headers: { 'x-api-key': 'secret' },
        })
      )
    ).resolves.toEqual({ authenticated: false, error: 'Authentication failed' })
    expect(mocks.updateLastUsed).not.toHaveBeenCalled()
  })
})
