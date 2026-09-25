import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  capability: vi.fn(),
  entitlement: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  rename: vi.fn(),
}))
vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/permission-groups/capability-assertions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/capability-assertions')>()),
  assertWorkspaceCapability: mocks.capability,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: 'org',
    allowPersonalApiKeys: true,
  }),
}))
vi.mock('@/lib/billing/core/subscription', () => ({ hasWorkspaceInboxAccess: mocks.entitlement }))
vi.mock('@/lib/mothership/inbox/lifecycle', () => ({
  enableInbox: mocks.enable,
  disableInbox: mocks.disable,
  updateInboxAddress: mocks.rename,
}))

import { readInboxSettings, updateInboxSettings } from '@/lib/workspaces/application/inbox-settings'

const principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  audience: 'sim:settings',
  delegationId: 'call',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
} as const
function current(enabled = false) {
  queueTableRows(schemaMock.workspace, [
    {
      inboxEnabled: enabled,
      inboxAddress: enabled ? 'current@example.com' : null,
      inboxProviderId: enabled ? 'provider' : null,
      inboxSecretScope: 'selected',
      inboxMountedSecrets: ['ALLOWED_SECRET'],
    },
  ])
}

describe('inbox settings application', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.role.mockResolvedValue('admin')
    mocks.capability.mockResolvedValue(undefined)
    mocks.entitlement.mockResolvedValue(true)
    mocks.enable.mockResolvedValue({ enabled: true, address: 'new@example.com', providerId: 'new' })
    mocks.rename.mockResolvedValue({
      enabled: true,
      address: 'renamed@example.com',
      providerId: 'renamed',
    })
  })

  it('reads bounded configuration and task rollups without provider secrets', async () => {
    current(true)
    queueTableRows(schemaMock.mothershipInboxTask, [
      { status: 'completed', count: 3 },
      { status: 'failed', count: 1 },
    ])
    const result = await readInboxSettings.execute({
      principal,
      input: { workspaceId: 'workspace' },
    })
    expect(result).toEqual({
      enabled: true,
      address: 'current@example.com',
      secretScope: 'selected',
      mountedSecrets: ['ALLOWED_SECRET'],
      entitled: true,
      taskStats: { total: 4, completed: 3, failed: 1, processing: 0 },
    })
  })

  it('disables without requiring an active paid plan', async () => {
    current(true)
    mocks.entitlement.mockResolvedValue(false)
    expect(
      await updateInboxSettings.execute({
        principal,
        input: { workspaceId: 'workspace', patch: { enabled: false } },
      })
    ).toMatchObject({ enabled: false, address: null, providerId: null })
    expect(mocks.disable).toHaveBeenCalledWith('workspace')
    expect(mocks.entitlement).not.toHaveBeenCalled()
  })

  it('refuses setup without entitlement and duplicate enablement', async () => {
    current()
    mocks.entitlement.mockResolvedValue(false)
    await expect(
      updateInboxSettings.execute({
        principal,
        input: { workspaceId: 'workspace', patch: { enabled: true } },
      })
    ).rejects.toThrow('Max plan')
    mocks.entitlement.mockResolvedValue(true)
    current(true)
    await expect(
      updateInboxSettings.execute({
        principal,
        input: { workspaceId: 'workspace', patch: { enabled: true } },
      })
    ).rejects.toThrow('already enabled')
    expect(mocks.enable).not.toHaveBeenCalled()
  })

  it('requires current admin authority for mutation and membership for reads', async () => {
    mocks.role.mockResolvedValue('read')
    await expect(
      updateInboxSettings.execute({
        principal,
        input: { workspaceId: 'workspace', patch: { enabled: false } },
      })
    ).rejects.toThrow()
    mocks.role.mockResolvedValue(null)
    await expect(
      readInboxSettings.execute({ principal, input: { workspaceId: 'workspace' } })
    ).rejects.toThrow()
    expect(mocks.disable).not.toHaveBeenCalled()
  })

  it('rejects stale and wrong-workspace delegated authority', async () => {
    await expect(
      updateInboxSettings.execute({
        principal: { ...principal, expiresAt: new Date(0) },
        input: { workspaceId: 'workspace', patch: { enabled: true } },
      })
    ).rejects.toThrow()
    await expect(
      updateInboxSettings.execute({
        principal,
        input: { workspaceId: 'foreign', patch: { enabled: true } },
      })
    ).rejects.toThrow()
    expect(mocks.enable).not.toHaveBeenCalled()
  })
})
