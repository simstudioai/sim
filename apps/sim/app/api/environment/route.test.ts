/**
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  environmentUtilsMockFns,
  posthogServerMock,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptSecret, mockSyncPersonalEnvCredentialsForUser } = vi.hoisted(() => ({
  mockEncryptSecret: vi.fn(),
  mockSyncPersonalEnvCredentialsForUser: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(),
  encryptSecret: mockEncryptSecret,
}))
vi.mock('@/lib/credentials/environment', () => ({
  syncPersonalEnvCredentialsForUser: mockSyncPersonalEnvCredentialsForUser,
}))

import { POST } from '@/app/api/environment/route'

describe('POST /api/environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
    })
    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-value' })
    mockSyncPersonalEnvCredentialsForUser.mockResolvedValue(undefined)
  })

  it('invalidates the effective environment cache immediately after the database update', async () => {
    const response = await POST(
      createMockRequest('POST', { variables: { JIRA_DOMAIN: 'example.atlassian.net' } })
    )

    expect(response.status).toBe(200)
    expect(environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache).toHaveBeenCalledWith({
      userId: 'user-1',
    })
    expect(dbChainMockFns.onConflictDoUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache.mock.invocationCallOrder[0]
    )
    expect(
      environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSyncPersonalEnvCredentialsForUser.mock.invocationCallOrder[0])
  })
})
