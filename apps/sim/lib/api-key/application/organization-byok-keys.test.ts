import type { SessionPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  hasMockCondition,
  posthogServerMock,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEntitled: vi.fn(),
  loadWorkspaceContext: vi.fn(),
  resolveWorkspacePermission: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))

vi.mock('@/lib/api-key/byok-entitlement', () => ({
  isOrganizationBYOKEntitled: mocks.isEntitled,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspaceContext,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolveWorkspacePermission,
}))

import {
  deleteOrganizationByokKey,
  listOrganizationByokKeys,
  readInheritedByokStatus,
  saveOrganizationByokKey,
} from '@/lib/api-key/application/organization-byok-keys'

const ORGANIZATION_ID = 'organization-1'
const WORKSPACE_ID = 'workspace-1'

const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-1',
  sessionId: 'session-1',
}

const workspaceKeyPrincipal: WorkspaceApiKeyPrincipal = {
  kind: 'workspace_api_key',
  workspaceId: WORKSPACE_ID,
  keyId: 'workspace-key-1',
}

const storedKeyRow = (id: string, providerId = 'openai') => ({
  id,
  organizationId: ORGANIZATION_ID,
  providerId,
  encryptedApiKey: `encrypted-${id}`,
  name: id === 'key-1' ? 'Primary' : null,
  createdBy: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
})

function queueOrganizationAdmin(role: 'admin' | 'owner' | 'member' = 'admin') {
  queueTableRows(schemaMock.member, [{ role }])
}

describe('organization BYOK application boundary', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.isEntitled.mockReset().mockResolvedValue(false)
    mocks.loadWorkspaceContext.mockReset().mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: ORGANIZATION_ID,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-user-1',
    })
    mocks.resolveWorkspacePermission.mockReset().mockResolvedValue('read')
    encryptionMockFns.mockDecryptSecret
      .mockReset()
      .mockResolvedValue({ decrypted: 'sk-decrypted-value' })
    encryptionMockFns.mockEncryptSecret
      .mockReset()
      .mockResolvedValue({ encrypted: 'encrypted-value', iv: 'iv' })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('rejects non-session principals before loading organization membership or key metadata', async () => {
    await expect(
      listOrganizationByokKeys.execute({
        principal: workspaceKeyPrincipal,
        input: { organizationId: ORGANIZATION_ID },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED',
    })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.isEntitled).not.toHaveBeenCalled()
  })

  it('rejects a regular member before reading keys or checking entitlement', async () => {
    queueOrganizationAdmin('member')

    await expect(
      listOrganizationByokKeys.execute({
        principal: sessionPrincipal,
        input: { organizationId: ORGANIZATION_ID },
      })
    ).rejects.toMatchObject({ code: 'forbidden', detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(mocks.isEntitled).not.toHaveBeenCalled()
  })

  it('allows an admin to list and clean up retained ciphertext after entitlement loss', async () => {
    queueOrganizationAdmin('owner')
    queueTableRows(schemaMock.organizationBYOKKeys, [storedKeyRow('key-1'), storedKeyRow('key-2')])
    encryptionMockFns.mockDecryptSecret
      .mockResolvedValueOnce({ decrypted: 'sk-production-secret' })
      .mockRejectedValueOnce(new Error('corrupt ciphertext'))

    const result = await listOrganizationByokKeys.execute({
      principal: sessionPrincipal,
      input: { organizationId: ORGANIZATION_ID },
    })

    expect(result).toMatchObject({
      entitled: false,
      keys: [
        { id: 'key-1', providerId: 'openai', name: 'Primary', maskedKey: 'sk-pro...cret' },
        { id: 'key-2', providerId: 'openai', name: null, maskedKey: '••••••••' },
      ],
    })
    expect(result.keys.every((key) => !('encryptedApiKey' in key))).toBe(true)

    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-2' }])
    queueOrganizationAdmin()
    await expect(
      deleteOrganizationByokKey.execute({
        principal: sessionPrincipal,
        input: { organizationId: ORGANIZATION_ID, providerId: 'openai', keyId: 'key-2' },
      })
    ).resolves.toEqual({ success: true })

    const deleteWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    for (const scopedValue of [ORGANIZATION_ID, 'openai', 'key-2']) {
      expect(
        hasMockCondition(
          deleteWhere,
          (condition) => condition.type === 'eq' && condition.right === scopedValue
        )
      ).toBe(true)
    }
  })

  it('requires entitlement before encryption or a write transaction starts', async () => {
    queueOrganizationAdmin()

    await expect(
      saveOrganizationByokKey.execute({
        principal: sessionPrincipal,
        input: {
          organizationId: ORGANIZATION_ID,
          providerId: 'openai',
          apiKey: 'sk-do-not-store',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden', detailCode: 'ORGANIZATION_PLAN_REQUIRED' })

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('updates only the scoped key, preserves its name, and remasks it', async () => {
    queueOrganizationAdmin()
    mocks.isEntitled.mockResolvedValue(true)
    queueTableRows(schemaMock.organizationBYOKKeys, [{ id: 'key-1', name: 'Primary' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-1' }])

    await expect(
      saveOrganizationByokKey.execute({
        principal: sessionPrincipal,
        input: {
          organizationId: ORGANIZATION_ID,
          providerId: 'openai',
          apiKey: 'sk-rotated-secret',
          keyId: 'key-1',
        },
      })
    ).resolves.toMatchObject({
      key: {
        id: 'key-1',
        providerId: 'openai',
        name: 'Primary',
        maskedKey: 'sk-rot...cret',
      },
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedApiKey: 'encrypted-value', name: 'Primary' })
    )
    const updateWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    for (const scopedValue of [ORGANIZATION_ID, 'openai', 'key-1']) {
      expect(
        hasMockCondition(
          updateWhere,
          (condition) => condition.type === 'eq' && condition.right === scopedValue
        )
      ).toBe(true)
    }
  })

  it('enforces the ten-key provider cap before encrypting or inserting', async () => {
    queueOrganizationAdmin()
    mocks.isEntitled.mockResolvedValue(true)
    queueTableRows(schemaMock.organizationBYOKKeys, [{ keyCount: 10 }])

    await expect(
      saveOrganizationByokKey.execute({
        principal: sessionPrincipal,
        input: {
          organizationId: ORGANIZATION_ID,
          providerId: 'anthropic',
          apiKey: 'sk-over-cap',
        },
      })
    ).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('at most 10') })

    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('returns only effective inherited provider IDs from the canonical workspace organization', async () => {
    mocks.isEntitled.mockResolvedValue(true)
    queueTableRows(schemaMock.workspaceBYOKKeys, [{ providerId: 'openai' }])
    queueTableRows(schemaMock.organizationBYOKKeys, [
      { providerId: 'anthropic' },
      { providerId: 'openai' },
    ])

    const result = await readInheritedByokStatus.execute({
      principal: sessionPrincipal,
      input: { workspaceId: WORKSPACE_ID },
    })

    expect(result).toEqual({ inheritedProviderIds: ['anthropic'] })
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID)
  })
})

describe('organization settings BYOK delegation', () => {
  const principal = {
    kind: 'organization_delegated',
    serviceId: 'copilot',
    subjectUserId: 'admin-1',
    organizationId: ORGANIZATION_ID,
    delegationId: 'byok-list',
    audience: 'sim:settings',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat' },
  } as const
  beforeEach(() => {
    resetDbChainMock()
    mocks.isEntitled.mockResolvedValue(false)
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({
      decrypted: 'sk-private-provider-value',
    })
  })
  it('revokes using canonical organization/provider scope and the actual delegated actor', async () => {
    queueOrganizationAdmin()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-1' }])
    await expect(
      deleteOrganizationByokKey.execute({
        principal,
        input: { organizationId: ORGANIZATION_ID, providerId: 'openai', keyId: 'key-1' },
      })
    ).resolves.toEqual({ success: true })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        metadata: expect.objectContaining({ operation: 'byok_keys.organization.delete' }),
      })
    )
  })
  it.each([
    { ...principal, organizationId: 'foreign' },
    { ...principal, audience: 'sim:search' },
    { ...principal, expiresAt: new Date(0) },
  ])('rejects invalid delegated scope before reading secrets', async (invalid) => {
    await expect(
      listOrganizationByokKeys.execute({
        principal: invalid,
        input: { organizationId: ORGANIZATION_ID },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
  it('keeps plaintext key submission on the authenticated browser flow', async () => {
    await expect(
      saveOrganizationByokKey.execute({
        principal,
        input: { organizationId: ORGANIZATION_ID, providerId: 'openai', apiKey: 'private' },
      })
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })
})
