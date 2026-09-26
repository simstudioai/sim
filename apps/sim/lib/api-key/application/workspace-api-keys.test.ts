import { apiKey } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  display: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/api-key/auth', () => ({ getApiKeyDisplayFormat: hoisted.display }))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  listWorkspaceApiKeys,
  renameWorkspaceApiKey,
  revokeWorkspaceApiKey,
} from '@/lib/api-key/application/workspace-api-keys'

const mocks = {
  ...hoisted,
  context: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  audit: auditMockFns.mockRecordAudit,
  analytics: posthogServerMockFns.mockCaptureServerEvent,
}

const principal = createDelegatedPrincipal({
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'keys',
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
