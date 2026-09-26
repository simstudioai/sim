import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { credentialGroupsAvailabilityMock } from '@sim/testing/mocks/credential-groups-availability.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)

import { loadScopedManagedMcpRuntimeCredential } from '@/lib/credentials/managed-mcp'

const mocks = { decrypt: encryptionMockFns.mockDecryptSecret }

const row = {
  credentialId: 'mine',
  managedConnectorId: 'coda',
  serverUrl: 'https://docs.superhuman.com/apis/mcp',
  status: 'active',
  groupStatus: 'active',
  enrollmentStatus: 'completed',
  enrollmentUserId: 'person',
  oauthConfigVersion: 1,
  serverOauthConfigVersion: 1,
  linkedCredentialGroupId: 'group',
  credentialGroupId: 'group',
  encryptedTokens: 'encrypted',
  tools: [],
  grantedAt: new Date(0),
  mcpServerId: 'server',
}
const scope = { kind: 'organization', organizationId: 'org' } as const

describe('personal scoped MCP runtime', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.decrypt.mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'managed-mcp-oauth-token-set',
        version: 1,
        tokens: { access_token: 'fixture-token' },
      }),
    })
  })
  it('binds decrypting the grant to the canonical scope and acting enrollment user', async () => {
    queueTableRows(schemaMock.credential, [row])
    expect(await loadScopedManagedMcpRuntimeCredential('mine', scope, 'person')).toMatchObject({
      credentialType: 'mcp:coda',
      credentialId: 'mine',
      scope,
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'person')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.organizationId, 'org')
  })
  it.each([
    { enrollmentUserId: 'someone-else' },
    { status: 'revoked' },
    { enrollmentStatus: 'revoked' },
    { serverOauthConfigVersion: 2 },
    { groupStatus: 'disabled' },
    { linkedCredentialGroupId: 'other' },
    { serverUrl: 'https://evil.example/mcp' },
  ])('does not decrypt a stale or mismatched grant: %o', async (change) => {
    queueTableRows(schemaMock.credential, [{ ...row, ...change }])
    await expect(loadScopedManagedMcpRuntimeCredential('mine', scope, 'person')).rejects.toThrow()
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
})
