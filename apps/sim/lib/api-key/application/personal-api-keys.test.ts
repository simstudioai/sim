/** @vitest-environment node */
import { apiKey, user } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  withheld: vi.fn(),
  display: vi.fn(),
  audit: vi.fn(),
  analytics: vi.fn(),
}))
vi.mock('@/lib/users/application/preferences-authorization', () => ({
  authorizeAccountPreferences: mocks.authorize,
}))
vi.mock('@/lib/permission-groups/user-scope.server', () => ({
  isCapabilityWithheldForUser: mocks.withheld,
}))
vi.mock('@/lib/api-key/auth', () => ({ getApiKeyDisplayFormat: mocks.display }))
vi.mock('@/lib/api-key/orchestration', () => ({ performCreatePersonalApiKey: vi.fn() }))
vi.mock('@sim/audit', () => ({
  AuditAction: { PERSONAL_API_KEY_REVOKED: 'personal_api_key.revoked' },
  AuditResourceType: { API_KEY: 'api_key' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import {
  listPersonalApiKeys,
  revokePersonalApiKey,
} from '@/lib/api-key/application/personal-api-keys'
import { DELETE } from '@/app/api/users/me/api-keys/[id]/route'
import { GET } from '@/app/api/users/me/api-keys/route'

const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.authorize.mockResolvedValue('actor')
  mocks.withheld.mockResolvedValue(false)
  mocks.display.mockResolvedValue('sim_••••abcd')
})
describe('personal API-key settings lifecycle', () => {
  it('returns only masked metadata for the authorized account subject', async () => {
    queueTableRows(apiKey, [
      {
        id: 'key',
        name: 'Personal',
        key: 'private-key',
        createdAt: new Date(),
        lastUsed: null,
        expiresAt: null,
      },
    ])
    const result = await listPersonalApiKeys.execute({ principal, input: {} })
    expect(result.keys[0]).toMatchObject({ id: 'key', displayKey: 'sim_••••abcd' })
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect(result.keys[0]).not.toHaveProperty('key')
  })
  it('withholds metadata before loading keys when management is disabled', async () => {
    mocks.withheld.mockResolvedValue(true)
    await expect(listPersonalApiKeys.execute({ principal, input: {} })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('preserves revocation when management is withheld and audits only the deleted key', async () => {
    mocks.withheld.mockResolvedValue(true)
    queueTableRows(user, [{ name: 'Actor', email: 'actor@example.com' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key', name: 'Personal' }])
    await expect(
      revokePersonalApiKey.execute({ principal, input: { keyId: 'key' } })
    ).resolves.toEqual({ success: true })
    expect(mocks.withheld).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor', resourceId: 'key', resourceName: 'Personal' })
    )
    expect(mocks.analytics).toHaveBeenCalledAfter(mocks.audit)
  })
  it('conceals absent and foreign keys without audit or analytics', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      revokePersonalApiKey.execute({ principal, input: { keyId: 'foreign' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
  it('fails before storage when the delegated account authority is stale', async () => {
    mocks.authorize.mockRejectedValueOnce(new Error('stale authority'))
    await expect(
      revokePersonalApiKey.execute({ principal, input: { keyId: 'key' } })
    ).rejects.toThrow('stale authority')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('retains the internal list response shape', async () => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'actor' },
      session: { id: 'session' },
    })
    queueTableRows(apiKey, [
      {
        id: 'key',
        name: 'Personal',
        key: 'private-key',
        createdAt: new Date('2026-01-01'),
        lastUsed: null,
        expiresAt: null,
      },
    ])
    const response = await GET(createMockRequest('GET'), {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      keys: [
        {
          id: 'key',
          name: 'Personal',
          displayKey: 'sim_••••abcd',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsed: null,
          expiresAt: null,
        },
      ],
    })
  })
  it('retains internal delete success and authenticates before mutation', async () => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'actor' },
      session: { id: 'session' },
    })
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key', name: 'Personal' }])
    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: 'key' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
})
