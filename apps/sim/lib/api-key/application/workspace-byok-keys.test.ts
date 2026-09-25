import { workspaceBYOKKeys } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  analytics: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required,
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@sim/audit', () => ({
  recordAudit: mocks.audit,
  AuditAction: { BYOK_KEY_DELETED: 'byok_key.deleted' },
  AuditResourceType: { BYOK_KEY: 'byok_key' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import {
  deleteWorkspaceByokKey,
  listWorkspaceByokKeys,
} from '@/lib/api-key/application/workspace-byok-keys'

const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'byok',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const
beforeEach(() => {
  resetDbChainMock()
  mocks.context.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing',
  })
  mocks.permission.mockResolvedValue('admin')
  mocks.decrypt.mockResolvedValue({ decrypted: 'sk-private-provider-key' })
})
describe('workspace BYOK delegated settings', () => {
  it('returns provider metadata and a mask without plaintext or encrypted credentials', async () => {
    queueTableRows(workspaceBYOKKeys, [
      {
        id: 'key',
        providerId: 'openai',
        name: 'Provider',
        encryptedApiKey: 'private-ciphertext',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'creator',
      },
    ])
    const result = await listWorkspaceByokKeys.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(result.keys[0]).toMatchObject({
      id: 'key',
      providerId: 'openai',
      maskedKey: 'sk-pri...-key',
    })
    expect(JSON.stringify(result)).not.toContain('private-provider')
    expect(JSON.stringify(result)).not.toContain('private-ciphertext')
    expect(result.keys[0]).not.toHaveProperty('encryptedApiKey')
  })
  it('preserves opaque mask fallback when stored key cannot be decrypted', async () => {
    queueTableRows(workspaceBYOKKeys, [{ id: 'key', encryptedApiKey: 'private-ciphertext' }])
    mocks.decrypt.mockRejectedValueOnce(new Error('unavailable'))
    const result = await listWorkspaceByokKeys.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(result.keys[0]).toMatchObject({ id: 'key', maskedKey: '••••••••' })
  })
  it.each([{ ...principal, workspaceId: 'foreign' }])(
    'rejects invalid delegation before reading credentials',
    async (invalid) => {
      await expect(
        listWorkspaceByokKeys.execute({ principal: invalid, input: { workspaceId: 'workspace' } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(mocks.decrypt).not.toHaveBeenCalled()
    }
  )
  it('requires current workspace admin authority for deletion', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(
      deleteWorkspaceByokKey.execute({
        principal,
        input: { workspaceId: 'workspace', providerId: 'openai', keyId: 'key' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('deletes with current actor and audits only authoritative removed IDs', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key' }])
    const result = await deleteWorkspaceByokKey.execute({
      principal,
      input: { workspaceId: 'workspace', providerId: 'openai', keyId: 'key' },
    })
    expect(result).toEqual({ success: true, deletedKeyIds: ['key'] })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor',
        workspaceId: 'workspace',
        metadata: expect.objectContaining({ providerId: 'openai', deletedKeyIds: ['key'] }),
      })
    )
  })
  it('conceals foreign or absent keys without audit', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      deleteWorkspaceByokKey.execute({
        principal,
        input: { workspaceId: 'workspace', providerId: 'openai', keyId: 'foreign' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })
})
