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

import { persistManagedMcpCredential } from '@/lib/credentials/managed-mcp'

const input = {
  workspaceId: 'workspace-1',
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
})
