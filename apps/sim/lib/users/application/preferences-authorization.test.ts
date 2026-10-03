import type { Principal } from '@sim/auth/principal'
import {
  createDelegatedPrincipal,
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

import { userAccountOperations } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'

const mocks = {
  role: workspaceAuthorizationMockFns.mockRequireCurrentHumanRole,
  organization: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const delegated = createDelegatedPrincipal({
  subjectUserId: 'actor',
  workspaceId: 'workspace',
  delegationId: 'tool',
  audience: 'sim:settings',
  resourceScope: { chatId: 'chat' },
})

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
      createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
      createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' }),
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
