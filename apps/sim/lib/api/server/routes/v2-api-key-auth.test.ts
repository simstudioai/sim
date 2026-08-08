/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateLastUsed: vi.fn(),
  resolveWorkspaceBillingPayer: vi.fn(),
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isAuthDisabled: false }))
vi.mock('@/lib/api-key/crypto', () => ({ hashApiKey: (value: string) => `hash:${value}` }))
vi.mock('@/lib/api-key/service', () => ({ updateApiKeyLastUsed: mocks.updateLastUsed }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mocks.resolveWorkspaceBillingPayer,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mocks.getHighestPrioritySubscription,
}))

import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'

describe('v2 API key authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.updateLastUsed.mockResolvedValue(undefined)
    mocks.getHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('normalizes a personal key without exposing loose optional identity fields', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
        userBanned: false,
      },
    ])

    const result = await authenticateV2ApiKey('secret')

    expect(result).toEqual({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    expect(mocks.getHighestPrioritySubscription).toHaveBeenCalledWith('user-1', {
      onError: 'throw',
    })
  })

  it('normalizes a workspace key as the workspace, not its creator', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'creator-1',
        workspaceId: 'workspace-1',
        type: 'workspace',
        expiresAt: null,
        userBanned: false,
      },
    ])
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      organizationId: 'organization-1',
      payerSubscription: {
        plan: 'team',
        referenceId: 'organization-1',
      },
    })

    const result = await authenticateV2ApiKey('secret')

    expect(result).toEqual({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      rolloutUserId: 'billing-owner-1',
      rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'],
      rateLimitSubscription: { plan: 'team', referenceId: 'organization-1' },
      keyType: 'workspace',
    })
    expect(mocks.getHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('does not couple a workspace key to its creator ban state', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'creator-1',
        workspaceId: 'workspace-1',
        type: 'workspace',
        expiresAt: null,
        userBanned: true,
      },
    ])
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      organizationId: null,
      payerSubscription: null,
    })

    await expect(authenticateV2ApiKey('secret')).resolves.toMatchObject({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
    })
  })

  it('treats missing, banned, and expired credentials as unauthenticated', async () => {
    await expect(authenticateV2ApiKey('missing')).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )

    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
        userBanned: true,
      },
    ])
    await expect(authenticateV2ApiKey('banned')).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )

    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-2',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: new Date(Date.now() - 1),
        userBanned: false,
      },
    ])
    await expect(authenticateV2ApiKey('expired')).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )
  })

  it('propagates auth-store failures instead of converting them to invalid credentials', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)

    await expect(authenticateV2ApiKey('secret')).rejects.toBe(failure)
  })
})
