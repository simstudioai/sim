/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lock: vi.fn() }))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  lockCredentialGroupEnrollmentLifecycle: mocks.lock,
}))
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn().mockResolvedValue({ encrypted: 'encrypted-token-set' }),
  decryptSecret: vi.fn(),
}))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn(),
}))
vi.mock('@/lib/credential-groups/availability', () => ({ isCredentialGroupsAvailable: vi.fn() }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: vi.fn(),
}))

import {
  persistManagedMcpCredential,
  saveManagedMcpRuntimeTokens,
  saveManagedMcpToolSnapshot,
} from '@/lib/credentials/managed-mcp'

const input = {
  organizationId: 'org-1',
  userId: 'person-1',
  oauthConfigVersion: 2,
  invitationTokenHash: 'current-invitation-hash',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  mcpServerId: 'mcp-server-1',
  mcpServerName: 'Fireflies',
  tokens: { access_token: 'fixture-access-token', token_type: 'Bearer' },
  tools: [],
}
const source = {
  enrollmentStatus: 'in_progress',
  enrollmentRevokedAt: null,
  credentialGroupId: input.credentialGroupId,
  groupStatus: 'active',
  linkedCredentialGroupId: input.credentialGroupId,
  managedConnectorId: 'fireflies',
}

describe('managed MCP grant persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    null,
    { ...source, enrollmentRevokedAt: new Date() },
    { ...source, enrollmentStatus: 'revoked' },
    { ...source, groupStatus: 'disabled' },
    { ...source, linkedCredentialGroupId: 'another-group' },
  ])(
    'refuses a grant after its captured enrollment authority changes during provider exchange',
    async (row) => {
      queueTableRows(schemaMock.credentialGroupEnrollment, row ? [row] : [])
      await expect(persistManagedMcpCredential(input)).rejects.toThrow('no longer available')
      expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), input.enrollmentId)
      expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, input.email)
      expect(eq).toHaveBeenCalledWith(
        schemaMock.credentialGroupEnrollment.credentialGroupId,
        input.credentialGroupId
      )
      expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )
  it('stores an organization grant bound to the current enrollment user and MCP setup', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [source])
    queueTableRows(schemaMock.credential, [])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'mcp-cg-person' }])
      .mockResolvedValueOnce([{ id: 'enrollment-1' }])
    await expect(persistManagedMcpCredential(input)).resolves.toMatchObject({
      created: true,
      enrollmentStatus: 'in_progress',
      connectionId: expect.stringMatching(/^mcp-cg-/),
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'person-1')
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.invitationTokenHash,
      input.invitationTokenHash
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.oauthConfigVersion, 2)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: null,
        mcpOauthConfigVersion: 2,
      })
    )
  })

  it('compares refresh writes with the encrypted token version', async () => {
    queueTableRows(schemaMock.credential, [{ enrollmentId: 'enrollment-1' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'mcp-cg-person' }])
    await saveManagedMcpRuntimeTokens('mcp-cg-person', input.tokens, 'previous-encrypted-token')
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credential.encryptedOauthTokenSet,
      'previous-encrypted-token'
    )
  })

  it('refuses a tool snapshot captured before reconnect or configuration replacement', async () => {
    const grantedAt = new Date('2026-09-01')
    dbChainMockFns.returning.mockResolvedValue([])
    await expect(saveManagedMcpToolSnapshot('mcp-cg-person', [], 2, grantedAt)).rejects.toThrow(
      'grant changed'
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.mcpOauthConfigVersion, 2)
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.grantedAt, grantedAt)
  })
})
