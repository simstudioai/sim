import { apiKey, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
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

const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
beforeEach(() => {
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
  })
  it('conceals absent and foreign keys without audit or analytics', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      revokePersonalApiKey.execute({ principal, input: { keyId: 'foreign' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
})
