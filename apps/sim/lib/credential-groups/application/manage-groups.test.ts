import type { CredentialGroupEnrollmentPrincipal, DelegatedPrincipal } from '@sim/auth/principal'
import { auditMock, auditMockFns } from '@sim/testing'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolveWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: hoisted.requireAvailable,
  resolveCredentialGroupSettingsContext: hoisted.resolveGroup,
  resolveCredentialGroupWorkspaceContext: hoisted.resolveWorkspace,
}))

vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)

vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ensureWorkspaceAccounts,
  getCredentialGroupSettings,
  getWorkspaceAccountsSettings,
} from '@/lib/credential-groups/application/manage-groups'
import { loadCopilotConnectedAccounts } from '@/lib/mothership/application/load-connected-accounts'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'

const mocks = {
  ...hoisted,
  ensure: credentialGroupsServiceMockFns.mockEnsureWorkspaceAccountsGroup,
  get: credentialGroupsServiceMockFns.mockGetCredentialGroup,
  list: credentialGroupsServiceMockFns.mockGetWorkspaceAccountsGroup,
  listEnrollments: credentialGroupsEnrollmentsMockFns.mockListCredentialGroupEnrollments,
}

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const sessionPrincipal = createSessionPrincipal({ userId: 'admin-1' })
const enrollmentPrincipal: CredentialGroupEnrollmentPrincipal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  invitationTokenHash: 'hash-1',
}

const copilotContext = requireTrustedCopilotExecutionContext({
  userId: 'admin-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-1',
  copilotToolExecution: true,
  chatId: 'chat-1',
})

function copilotPrincipal(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
  return {
    ...createDelegatedPrincipal({
      subjectUserId: 'admin-1',
      delegationId: 'copilot-tool:tool-1',
      audience: 'sim:credential-groups',
      resourceScope: { chatId: 'chat-1' },
    }),
    ...overrides,
  }
}

describe('Credential Group Settings application operations', () => {
  beforeEach(() => {
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolveGroup.mockResolvedValue({
      ...workspaceContext,
      credentialGroupId: 'group-1',
      name: 'Support',
    })
    resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.list.mockResolvedValue(null)
    mocks.ensure.mockResolvedValue({
      id: 'accounts-1',
      name: 'Connected accounts',
      options: [],
      created: true,
    })
    mocks.get.mockResolvedValue({ id: 'group-1', name: 'Support' })
    mocks.listEnrollments.mockResolvedValue({ enrollments: [], nextCursor: null })
  })

  it('rejects an enrollment bearer before loading workspace settings', async () => {
    await expect(
      getWorkspaceAccountsSettings.execute({
        principal: enrollmentPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
  })

  it('requires current workspace-admin permission before listing', async () => {
    resolvePermission.mockResolvedValue('read')

    await expect(
      getWorkspaceAccountsSettings.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('reauthorizes connected-account reads after the acting admin is demoted', async () => {
    await loadCopilotConnectedAccounts(copilotContext)
    mocks.list.mockClear()
    resolvePermission.mockResolvedValue('read')
    await expect(loadCopilotConnectedAccounts(copilotContext)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.listEnrollments).not.toHaveBeenCalled()
  })

  it('rechecks account availability on each authorized read', async () => {
    await loadCopilotConnectedAccounts(copilotContext)
    mocks.list.mockClear()
    mocks.requireAvailable.mockRejectedValue(new OrchestrationError('not_found', 'Unavailable'))
    await expect(loadCopilotConnectedAccounts(copilotContext)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each([
    { audience: 'sim:knowledge' },
    { workspaceId: 'other-workspace' },
    { resourceScope: { credentialId: 'other-credential' } },
    { expiresAt: new Date(0) },
    { subjectUserId: undefined },
    { serviceId: 'executor' as const },
  ])('rejects invalid account-read delegation %j', async (overrides) => {
    await expect(
      getWorkspaceAccountsSettings.execute({
        principal: copilotPrincipal(overrides),
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('does not grant Copilot enrollment reads or account setup', async () => {
    const principal = copilotPrincipal()
    await expect(
      getCredentialGroupSettings.execute({
        principal,
        input: { assertedWorkspaceId: 'workspace-1', credentialGroupId: 'group-1', limit: 100 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      ensureWorkspaceAccounts.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveGroup).not.toHaveBeenCalled()
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.listEnrollments).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'personal_api_key', userId: 'admin-1', keyId: 'personal-key' } as const,
    { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'workspace-key' } as const,
  ])('refuses $kind account metadata before loading workspace context', async (principal) => {
    await expect(
      getWorkspaceAccountsSettings.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('sets up workspace accounts using canonical workspace scope and the acting admin', async () => {
    mocks.resolveWorkspace.mockResolvedValue({
      ...workspaceContext,
      workspaceId: 'canonical-workspace',
    })
    const result = await ensureWorkspaceAccounts.execute({
      principal: sessionPrincipal,
      input: { workspaceId: 'workspace-1' },
    })
    expect(mocks.resolveWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(mocks.requireAvailable).toHaveBeenCalledWith('canonical-workspace')
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith('canonical-workspace', 'admin-1')
    expect(result).toEqual({
      credentialGroup: { id: 'accounts-1', name: 'Connected accounts', options: [] },
      created: true,
    })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'canonical-workspace',
        actorId: 'admin-1',
        resourceId: 'accounts-1',
        metadata: expect.objectContaining({ operation: 'credential_groups.workspace.ensure' }),
      })
    )
  })

  it('returns an existing account group without recording another creation audit', async () => {
    mocks.ensure.mockResolvedValue({
      id: 'accounts-1',
      name: 'Connected accounts',
      options: [],
      created: false,
    })
    const result = await ensureWorkspaceAccounts.execute({
      principal: sessionPrincipal,
      input: { workspaceId: 'workspace-1' },
    })
    expect(result.created).toBe(false)
    expect(result.credentialGroup.id).toBe('accounts-1')
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('refuses reader account setup before entitlement checks or persistence', async () => {
    resolvePermission.mockResolvedValue('read')
    await expect(
      ensureWorkspaceAccounts.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requireAvailable).not.toHaveBeenCalled()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it.each([
    enrollmentPrincipal,
    { kind: 'personal_api_key', userId: 'admin-1', keyId: 'personal-key' } as const,
    { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'workspace-key' } as const,
  ])('refuses $kind account setup before resolving protected context', async (principal) => {
    await expect(
      ensureWorkspaceAccounts.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('does not create accounts when the authorized workspace lacks the entitlement', async () => {
    mocks.requireAvailable.mockRejectedValue(
      new OrchestrationError('not_found', 'Credential Groups are not available')
    )
    await expect(
      ensureWorkspaceAccounts.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('excludes deleted people from Credential Group settings', async () => {
    await getCredentialGroupSettings.execute({
      principal: sessionPrincipal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        limit: 50,
      },
    })

    expect(mocks.listEnrollments).toHaveBeenCalledWith('workspace-1', 'group-1', 50, undefined, {
      statuses: ['invited', 'in_progress', 'completed', 'delivery_failed'],
    })
  })
})
