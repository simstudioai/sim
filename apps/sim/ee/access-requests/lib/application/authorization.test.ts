import { db } from '@sim/db'
import { member, permissions, user, workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import type { DbOrTx } from '@/lib/db/types'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import {
  authorizeAccessRequestScope,
  loadAccessRequestMembership,
} from '@/ee/access-requests/lib/application/authorization'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'

const mocks = {
  effectiveRole: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  workspaceConfig: permissionGroupScopeMockFns.mockResolvePermissionGroupConfig,
}

const principal = createSessionPrincipal({ userId: 'person', sessionId: 'session' })
const workspaceScope = { kind: 'workspace' as const, workspaceId: 'workspace' }
const organizationScope = { kind: 'organization' as const, organizationId: 'org' }
const activePerson = { suspendedAt: null, banned: false, banExpires: null }
const canonicalWorkspace = { id: 'workspace', organizationId: 'org', allowPersonalApiKeys: false }

function queueMembership(orgRole: string | null = 'member', grantId: string | null = 'grant') {
  queueTableRows(user, [activePerson])
  queueTableRows(member, orgRole ? [{ id: 'membership', role: orgRole }] : [])
  queueTableRows(permissions, grantId ? [{ id: grantId }] : [])
}

beforeEach(() => {
  resetDbChainMock()
  mocks.workspaceConfig.mockResolvedValue(null)
  mocks.effectiveRole.mockResolvedValue('read')
  mocks.config.mockRejectedValue(new Error('A capability-exempt session must not load config'))
})

describe('access request membership identity', () => {
  it('permits an external member only through an explicit effective workspace grant', async () => {
    queueMembership(null)
    await expect(loadAccessRequestMembership(db, 'person', workspaceScope, 'org')).resolves.toEqual(
      {
        membershipId: '[null,"grant"]',
        role: 'read',
      }
    )
    expect(mocks.effectiveRole).toHaveBeenCalledWith('person', 'workspace', 'org', db, {
      forUpdate: false,
    })
  })

  it('does not substitute organization membership for workspace access', async () => {
    queueMembership('member', null)
    mocks.effectiveRole.mockResolvedValue(null)
    await expect(
      loadAccessRequestMembership(db, 'person', workspaceScope, 'org')
    ).resolves.toBeNull()
  })

  it('does not substitute workspace administrator access for organization membership', async () => {
    queueMembership(null)
    mocks.effectiveRole.mockResolvedValue('admin')
    await expect(
      loadAccessRequestMembership(db, 'person', organizationScope, 'org')
    ).resolves.toBeNull()
    expect(mocks.effectiveRole).not.toHaveBeenCalled()
  })

  it('fails closed on an unknown organization role', async () => {
    queueMembership('billing-admin')
    await expect(
      loadAccessRequestMembership(db, 'person', organizationScope, 'org')
    ).resolves.toBeNull()
  })

  it.each([
    { ...activePerson, suspendedAt: new Date() },
    { ...activePerson, banned: true },
    { ...activePerson, banned: true, banExpires: new Date('2099-01-01') },
  ])('refuses an account that is currently blocked', async (person) => {
    queueTableRows(user, [person])
    await expect(
      loadAccessRequestMembership(db, 'person', workspaceScope, 'org', true)
    ).resolves.toBeNull()
    expect(mocks.effectiveRole).not.toHaveBeenCalled()
    expect(dbChainMockFns.from).toHaveBeenCalledExactlyOnceWith(user)
  })
})

describe('access request scope authorization', () => {
  it('conceals a workspace tenant change before looking up anyone in the new organization', async () => {
    queueTableRows(workspace, [{ ...canonicalWorkspace, organizationId: 'other-org' }])
    await expect(
      authorizeAccessRequestScope(
        principal,
        accessRequestOperations.create,
        workspaceScope,
        db,
        true,
        {
          organizationId: 'org',
          membershipId: '["membership","grant"]',
        }
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.from).toHaveBeenCalledExactlyOnceWith(workspace)
    expect(mocks.effectiveRole).not.toHaveBeenCalled()
  })

  it('refuses a recreated explicit grant even when its current role is sufficient', async () => {
    queueTableRows(workspace, [canonicalWorkspace])
    queueMembership('member', 'replacement-grant')
    await expect(
      authorizeAccessRequestScope(
        principal,
        accessRequestOperations.create,
        workspaceScope,
        db,
        true,
        {
          organizationId: 'org',
          membershipId: '["membership","grant"]',
        }
      )
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a recreated organization membership for an in-flight operation', async () => {
    queueMembership('admin')
    await expect(
      authorizeAccessRequestScope(
        principal,
        accessRequestOperations.resolve,
        organizationScope,
        db,
        true,
        {
          organizationId: 'org',
          membershipId: '["removed-membership",null]',
        }
      )
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rechecks administrator authority through the shared organization funnel in a transaction', async () => {
    const executor = { select: db.select } as DbOrTx
    queueMembership('member')
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      authorizeAccessRequestScope(
        principal,
        accessRequestOperations.resolve,
        organizationScope,
        executor,
        true
      )
    ).rejects.toThrow('Organization administrator access is required')
    expect(dbChainMockFns.from.mock.calls.filter(([table]) => table === member)).toHaveLength(2)
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it('never authorizes organization review from a workspace-scoped request', async () => {
    await expect(
      authorizeAccessRequestScope(principal, accessRequestOperations.resolve, workspaceScope)
    ).rejects.toThrow('Organization administrator access is required')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('conceals an archived or removed workspace before membership lookup', async () => {
    queueTableRows(workspace, [])
    await expect(
      authorizeAccessRequestScope(principal, accessRequestOperations.create, workspaceScope)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.from).toHaveBeenCalledExactlyOnceWith(workspace)
  })
})

describe('access request credential policy', () => {
  const key = createPersonalApiKeyPrincipal({ userId: 'person', keyId: 'key' })
  const oauth = {
    kind: 'oauth_access_token',
    userId: 'person',
    tokenId: 'token',
    clientId: SIM_CLI_CLIENT_ID,
    scopes: ['api:write'],
    expiresAt: new Date('2099-01-01'),
  } as const

  it.each([key, oauth])(
    'admits $kind in a workspace only through the current human grant',
    async (caller) => {
      queueTableRows(workspace, [{ ...canonicalWorkspace, allowPersonalApiKeys: true }])
      queueMembership(null)
      await expect(
        authorizeAccessRequestScope(caller, accessRequestOperations.create, workspaceScope)
      ).resolves.toMatchObject({ membershipId: '[null,"grant"]' })
      expect(mocks.workspaceConfig).toHaveBeenCalled()
    }
  )

  it.each(['disablePersonalApiKeys', 'disableOAuthAppAccess', 'disableCliAccess'] as const)(
    'enforces %s even though access requests are capability-exempt',
    async (restriction) => {
      queueTableRows(workspace, [{ ...canonicalWorkspace, allowPersonalApiKeys: true }])
      queueMembership()
      mocks.workspaceConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        [restriction]: true,
      })
      await expect(
        authorizeAccessRequestScope(oauth, accessRequestOperations.create, workspaceScope)
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  )

  it.each([key, oauth])(
    'requires an administrator for organization review with $kind',
    async (caller) => {
      queueMembership('member')
      queueTableRows(member, [{ role: 'member' }])
      mocks.config.mockResolvedValue(null)
      await expect(
        authorizeAccessRequestScope(caller, accessRequestOperations.resolve, organizationScope)
      ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    }
  )

  it.each([key, oauth])(
    'reauthorizes current organization credential restrictions for $kind',
    async (caller) => {
      queueMembership('admin')
      queueTableRows(member, [{ role: 'admin' }])
      mocks.config.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disablePersonalApiKeys: true,
      })
      await expect(
        authorizeAccessRequestScope(caller, accessRequestOperations.resolve, organizationScope)
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.config).toHaveBeenCalledWith('org', db)
    }
  )
})
