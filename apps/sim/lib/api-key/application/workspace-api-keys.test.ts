import { apiKey } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  display: vi.fn(),
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
vi.mock('@/lib/api-key/auth', () => ({ getApiKeyDisplayFormat: mocks.display }))
vi.mock('@sim/audit', () => ({
  recordAudit: mocks.audit,
  AuditAction: { API_KEY_UPDATED: 'key.updated', API_KEY_REVOKED: 'key.revoked' },
  AuditResourceType: { API_KEY: 'api_key' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import {
  listWorkspaceApiKeys,
  renameWorkspaceApiKey,
  revokeWorkspaceApiKey,
} from '@/lib/api-key/application/workspace-api-keys'

const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'keys',
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
  mocks.display.mockResolvedValue('sim_••••key')
})
describe('workspace API-key delegated settings', () => {
  it('returns only masked metadata', async () => {
    queueTableRows(apiKey, [
      {
        id: 'key',
        name: 'Key',
        key: 'private-key',
        createdAt: new Date(),
        lastUsed: null,
        expiresAt: null,
        createdBy: 'creator',
      },
    ])
    const result = await listWorkspaceApiKeys.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(result.keys[0]).toMatchObject({ id: 'key', displayKey: 'sim_••••key' })
    expect(JSON.stringify(result)).not.toContain('private-key')
  })
  it.each([{ ...principal, workspaceId: 'foreign' }])(
    'rejects invalid delegation before key lookup',
    async (invalid) => {
      await expect(
        listWorkspaceApiKeys.execute({ principal: invalid, input: { workspaceId: 'workspace' } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
  it('requires current admin permission for revocation', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(
      revokeWorkspaceApiKey.execute({
        principal,
        input: { workspaceId: 'workspace', keyId: 'key' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('does not audit a key that disappeared before update', async () => {
    queueTableRows(apiKey, [{ id: 'key', name: 'Old' }])
    queueTableRows(apiKey, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      renameWorkspaceApiKey.execute({
        principal,
        input: { workspaceId: 'workspace', keyId: 'key', name: 'New' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
