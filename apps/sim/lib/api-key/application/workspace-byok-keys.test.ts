import { workspaceBYOKKeys } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  deleteWorkspaceByokKey,
  listWorkspaceByokKeys,
} from '@/lib/api-key/application/workspace-byok-keys'

const mocks = {
  ...hoisted,
  context: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  decrypt: encryptionMockFns.mockDecryptSecret,
  audit: auditMockFns.mockRecordAudit,
  analytics: posthogServerMockFns.mockCaptureServerEvent,
}

const principal = createDelegatedPrincipal({
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'byok',
  audience: 'sim:settings',
  resourceScope: { chatId: 'chat' },
})
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
