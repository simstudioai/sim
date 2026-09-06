/**
 * @vitest-environment node
 */
import type {
  CredentialGroupEnrollmentPrincipal,
  DelegatedPrincipal,
  SessionPrincipal,
} from '@sim/auth/principal'
import { auditMock, auditMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listEnrollments: vi.fn(),
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: mocks.requireAvailable,
  resolveCredentialGroupSettingsContext: mocks.resolveGroup,
  resolveCredentialGroupWorkspaceContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: mocks.ensure,
  getCredentialGroup: mocks.get,
  getWorkspaceAccountsGroup: mocks.list,
  updateCredentialGroup: vi.fn(),
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  CredentialGroupEnrollmentError: class CredentialGroupEnrollmentError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  },
  listCredentialGroupEnrollments: mocks.listEnrollments,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

/** The VFS lazy-read regression exercises account authorization, not provider registries. */
vi.mock('@/blocks/registry-maps', () => ({ BLOCK_REGISTRY: {}, BLOCK_META_REGISTRY: {} }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))
vi.mock('@/triggers/registry', () => ({ TRIGGER_REGISTRY: {} }))

import { loadCopilotConnectedAccounts } from '@/lib/copilot/application/load-connected-accounts'
import { requireTrustedCopilotExecutionContext } from '@/lib/copilot/auth/application-delegation'
import { WorkspaceVFS } from '@/lib/copilot/vfs/workspace-vfs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ensureWorkspaceAccounts,
  getCredentialGroupSettings,
  getWorkspaceAccountsSettings,
} from '@/lib/credential-groups/application/manage-groups'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-1',
  sessionId: 'session-1',
}
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
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'admin-1',
    workspaceId: 'workspace-1',
    delegationId: 'copilot-tool:tool-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat-1' },
    ...overrides,
  }
}

function mountAccounts(vfs: WorkspaceVFS, permission = 'admin', enabled = true) {
  return (
    vfs as unknown as {
      materializeConnectedAccounts(context: {
        features: { credentialGroups: boolean }
        viewer: { permission: string }
      }): boolean
    }
  ).materializeConnectedAccounts({
    features: { credentialGroups: enabled },
    viewer: { permission },
  })
}

describe('Credential Group Settings application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolveGroup.mockResolvedValue({
      ...workspaceContext,
      credentialGroupId: 'group-1',
      name: 'Support',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
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
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      getWorkspaceAccountsSettings.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists settings only after authorization and entitlement checks', async () => {
    const result = await getWorkspaceAccountsSettings.execute({
      principal: sessionPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(mocks.requireAvailable).toHaveBeenCalledWith('workspace-1')
    expect(mocks.list).toHaveBeenCalledWith('workspace-1')
    expect(result.credentialGroup).toBeNull()
    /**
     * Which providers are offerable depends on the OAuth clients this environment configures, so
     * the list is asserted as a shape rather than a fixed set.
     */
    expect(Array.isArray(result.availableProviders)).toBe(true)
  })

  it('reads singleton readiness through trusted Copilot with the acting admin', async () => {
    mocks.list.mockResolvedValue({ status: 'active', options: [] })
    await expect(loadCopilotConnectedAccounts(copilotContext)).resolves.toEqual({
      status: 'active',
      options: [],
    })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'admin-1',
      'workspace-1',
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('workspace-1')
    expect(mocks.listEnrollments).not.toHaveBeenCalled()
  })

  it('reauthorizes a mounted lazy account catalog after the admin is demoted', async () => {
    const vfs = new WorkspaceVFS(undefined, undefined, () =>
      loadCopilotConnectedAccounts(copilotContext)
    )
    expect(mountAccounts(vfs)).toBe(true)
    expect(vfs.glob('organization/*')).toContain('organization/connected-accounts.json')
    expect(mocks.list).not.toHaveBeenCalled()

    mocks.resolvePermission.mockResolvedValue('read')
    await expect(vfs.read('organization/connected-accounts.json')).resolves.toBeNull()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.listEnrollments).not.toHaveBeenCalled()
  })

  it('loads only singleton readiness when an admin opens the catalog', async () => {
    mocks.list.mockResolvedValue({
      id: 'internal-container-id',
      status: 'active',
      options: [
        {
          id: 'internal-option-id',
          provider: 'slack',
          status: 'active',
          configurationStatus: 'ready',
          slackBotCredentialId: 'internal-credential-id',
        },
      ],
    })
    const vfs = new WorkspaceVFS(undefined, undefined, () =>
      loadCopilotConnectedAccounts(copilotContext)
    )
    mountAccounts(vfs)
    const result = await vfs.read('organization/connected-accounts.json')
    expect(JSON.parse(result!.content)).toMatchObject({
      status: 'active',
      options: [{ provider: 'slack', status: 'active', configurationStatus: 'ready' }],
    })
    expect(result!.content).not.toContain('internal-')
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('workspace-1')
    expect(mocks.listEnrollments).not.toHaveBeenCalled()
  })

  it('rechecks availability before resolving a previously mounted catalog', async () => {
    const vfs = new WorkspaceVFS(undefined, undefined, () =>
      loadCopilotConnectedAccounts(copilotContext)
    )
    mountAccounts(vfs)
    mocks.requireAvailable.mockRejectedValue(new OrchestrationError('not_found', 'Unavailable'))
    await expect(vfs.read('organization/connected-accounts.json')).resolves.toBeNull()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each([
    { permission: 'read', enabled: true },
    { permission: 'admin', enabled: false },
  ])('does not advertise unavailable accounts: %j', async ({ permission, enabled }) => {
    const vfs = new WorkspaceVFS(undefined, undefined, () =>
      loadCopilotConnectedAccounts(copilotContext)
    )
    expect(mountAccounts(vfs, permission, enabled)).toBe(false)
    expect(vfs.glob('organization/*')).toEqual([])
    await expect(vfs.read('organization/connected-accounts.json')).resolves.toBeNull()
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
  })

  it('does not mount account metadata without its trusted application loader', () => {
    expect(mountAccounts(new WorkspaceVFS())).toBe(false)
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
    mocks.resolvePermission.mockResolvedValue('read')
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
