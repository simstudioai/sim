/** @vitest-environment node */
import type { SessionPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  evict: vi.fn(),
  invite: vi.fn(),
  available: vi.fn(),
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  lockCredentialGroupEnrollmentLifecycle: mocks.lock,
}))
vi.mock('@/lib/mcp/connection-pool', () => ({ evictMcpServerConnections: mocks.evict }))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: mocks.invite,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))

import {
  disconnectPersonalOrganizationAccount,
  listPersonalOrganizationAccounts,
  reconnectPersonalOrganizationAccount,
} from '@/lib/credential-groups/application/personal-organization-accounts'

const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'contributor',
  sessionId: 'session-1',
}
const input = { credentialId: 'mcp-cg-person' }
const row = {
  ...input,
  displayName: 'Fireflies',
  providerId: null,
  type: 'managed_mcp',
  status: 'active',
  organizationId: 'org-1',
  organizationName: 'Acme',
  groupId: 'group-1',
  groupStatus: 'active',
  enrollmentId: 'enrollment-1',
  enrollmentStatus: 'completed',
  optionId: null,
  mcpProvider: 'fireflies',
}

describe('personal organization contributions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.invite.mockResolvedValue({ invitationLink: 'https://sim.test/enroll/token' })
  })

  it('lists only the stable signed-in identity without requiring org membership', async () => {
    queueTableRows(schemaMock.credential, [row])
    const result = await listPersonalOrganizationAccounts.execute({ principal, input: {} })
    expect(result.accounts).toEqual([
      expect.objectContaining({
        credentialId: 'mcp-cg-person',
        providerId: 'fireflies',
        canReconnect: true,
      }),
    ])
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'contributor')
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.member)
  })

  it('refuses disconnect of another contributor’s account', async () => {
    queueTableRows(schemaMock.credential, [])
    await expect(
      disconnectPersonalOrganizationAccount.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rechecks ownership under the lifecycle lock before revoking', async () => {
    queueTableRows(schemaMock.credential, [row])
    queueTableRows(schemaMock.credential, [])
    await expect(
      disconnectPersonalOrganizationAccount.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.lock).toHaveBeenCalledWith(expect.any(Object), 'enrollment-1')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('revokes locally and invalidates pending attempts even with the flag off', async () => {
    queueTableRows(schemaMock.credential, [row])
    queueTableRows(schemaMock.credential, [row])
    mocks.available.mockResolvedValue(false)
    await disconnectPersonalOrganizationAccount.execute({ principal, input })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ managedOauthStatus: 'revoked', revokedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ invitationTokenHash: expect.any(String) })
    )
    expect(mocks.evict).toHaveBeenCalledWith('mcp-cg-person', expect.any(String))
    expect(mocks.available).not.toHaveBeenCalled()
  })

  it('does not restore an enrollment revoked by its administrator', async () => {
    queueTableRows(schemaMock.credential, [{ ...row, enrollmentStatus: 'revoked' }])
    await expect(
      reconnectPersonalOrganizationAccount.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.invite).not.toHaveBeenCalled()
  })
})
