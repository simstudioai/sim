import type { Principal, SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ organization: vi.fn(), workspace: vi.fn(), role: vi.fn() }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.organization,
}))
vi.mock('@/lib/core/application/workspace-authorization', () => ({
  requireCurrentHumanRole: mocks.role,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))

import { userAccountOperations } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'

const delegated: SubjectDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'tool',
  audience: 'sim:settings',
  issuedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
}

describe('account preferences authority', () => {
  beforeEach(() => {
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: 'org',
      allowPersonalApiKeys: false,
    })
    mocks.role.mockResolvedValue(undefined)
    mocks.organization.mockResolvedValue({ userId: 'actor', organizationId: 'org', role: 'member' })
  })
  it('uses the real delegated subject and rechecks current hosting workspace access', async () => {
    await expect(
      authorizeAccountPreferences(delegated, userAccountOperations.updateSettings)
    ).resolves.toBe('actor')
    expect(mocks.role).toHaveBeenCalledWith(
      'actor',
      expect.objectContaining({ workspaceId: 'workspace' }),
      'read'
    )
  })
  it.each([
    { ...delegated, audience: 'sim:files' },
    { ...delegated, expiresAt: new Date(0) },
    { ...delegated, issuedAt: new Date(Date.now() + 60_000) },
    { ...delegated, expiresAt: new Date(Number.NaN) },
    { ...delegated, resourceScope: {} },
  ])('refuses invalid delegation before protected lookups', async (principal) => {
    await expect(
      authorizeAccountPreferences(principal, userAccountOperations.updateSettings)
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.organization).not.toHaveBeenCalled()
  })
  it('does not grant self-account operations to API keys or executors', async () => {
    const principals: Principal[] = [
      { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
      { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
      { ...delegated, serviceId: 'executor' },
    ]
    for (const principal of principals) {
      await expect(
        authorizeAccountPreferences(principal, userAccountOperations.updateSettings)
      ).rejects.toBeInstanceOf(Error)
    }
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('does not extend account deletion authority to settings delegations', async () => {
    await expect(
      authorizeAccountPreferences(delegated, userAccountOperations.delete)
    ).rejects.toBeInstanceOf(Error)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('propagates revoked hosting access rather than writing as another member', async () => {
    mocks.role.mockRejectedValue(new Error('revoked'))
    await expect(
      authorizeAccountPreferences(delegated, userAccountOperations.updateSettings)
    ).rejects.toThrow('revoked')
  })
})
