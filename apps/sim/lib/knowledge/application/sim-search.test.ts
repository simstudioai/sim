/**
 * @vitest-environment node
 */

import { knowledgeBase, knowledgeConnector, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  isMemberAccessAvailable: vi.fn(),
  requireMirroredAccess: vi.fn(),
  createKnowledgeBase: vi.fn(),
  createOrganizationKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  createConnector: vi.fn(),
  createApprovedSource: vi.fn(),
  requireApproval: vi.fn(),
  deleteConnector: vi.fn(),
  enroll: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  recordAudit: vi.fn(),
  ensureAccounts: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: mocks.ensureAccounts,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/knowledge/access/availability', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  return {
    isKnowledgeMemberAccessAvailable: mocks.isMemberAccessAvailable,
    requireSourceMirroredAccessAvailable: mocks.requireMirroredAccess,
    requireKnowledgeMemberAccessAvailable: async (context: { workspaceId: string }) => {
      if (await mocks.isMemberAccessAvailable(context)) return
      throw new OrchestrationError(
        'validation',
        'Per-member access is not available for this workspace'
      )
    },
  }
})

vi.mock('@/lib/knowledge/service', () => ({
  createAuthorizedKnowledgeBase: mocks.createOrganizationKnowledgeBase,
}))
vi.mock('@/lib/knowledge/embeddings', () => ({
  getConfiguredKbEmbedding: async () => ({ model: 'test-embedding', dimensions: 1536 }),
}))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  createKnowledgeBase: { execute: mocks.createKnowledgeBase },
  deleteKnowledgeBaseOperation: { execute: mocks.deleteKnowledgeBase },
}))

vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  requireOrganizationSearchApproval: mocks.requireApproval,
}))

vi.mock('@/lib/knowledge/application/connectors', () => ({
  createApprovedSearchSource: { execute: mocks.createApprovedSource },
  createKnowledgeConnector: { execute: mocks.createConnector },
  deleteKnowledgeConnector: { execute: mocks.deleteConnector },
}))

vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: { execute: mocks.enroll },
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
  getUserPermissionConfigForOrganization: async () => null,
}))

vi.mock('@/lib/sim-search/connectors', () => ({
  SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
  canConnectPersonally: (meta: { permissionScopedListing?: unknown }) =>
    Boolean(meta.permissionScopedListing),
  missingSetupFields: (
    meta: { configFields: Array<{ id: string; title: string; required?: boolean }> },
    sourceConfig: Record<string, unknown>
  ) =>
    meta.configFields.filter(
      (field) => field.required && typeof sourceConfig[field.id] !== 'string'
    ),
}))

vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    gitlab: {
      name: 'GitLab',
      search: true,
      auth: { mode: 'apiKey' },
      mirrorsSourceAcls: true,
      configFields: [],
    },
    google_drive: {
      name: 'Google Drive',
      search: true,
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [],
    },
    confluence: {
      name: 'Confluence',
      search: true,
      auth: { mode: 'oauth', provider: 'confluence' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [{ id: 'spaceKey', title: 'a space key', required: true }],
    },
  },
}))

import {
  connectSimSearchConnector,
  prepareSearchSource,
} from '@/lib/knowledge/application/sim-search'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const existingConnector = { knowledgeBaseId: 'kb-search', connectorId: 'connector-drive' }

/** The first lookup runs before the coalesced creation and the second inside it. */
function queueConnectorLookups(...results: Array<typeof existingConnector | null>) {
  for (const result of results) {
    queueTableRows(knowledgeConnector, result ? [result] : [])
  }
}

describe('connectSimSearchConnector', () => {
  afterAll(resetDbChainMock)

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.getUserPermissionConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
    mocks.isMemberAccessAvailable.mockResolvedValue(true)
    mocks.createKnowledgeBase.mockResolvedValue({ knowledgeBase: { id: 'kb-new' } })
    mocks.createConnector.mockResolvedValue({ connector: { id: 'connector-new' } })
    mocks.enroll.mockResolvedValue({ url: 'https://sim.test/enroll/token' })
    mocks.ensureAccounts.mockResolvedValue({ id: 'accounts-group' })
  })

  it('enrolls a reader in a source someone already connected', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueConnectorLookups(existingConnector)

    const result = await connectSimSearchConnector.execute({
      principal,
      input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
    })

    expect(result).toEqual({ ...existingConnector, url: 'https://sim.test/enroll/token' })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
    expect(mocks.enroll).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: { ...existingConnector, assertedWorkspaceId: 'workspace-1' },
      })
    )
  })

  it('prepares a supported administrative source in the existing workspace index', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueTableRows(knowledgeBase, [{ id: 'kb-existing' }])
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'gitlab' },
      })
    ).resolves.toEqual({ knowledgeBaseId: 'kb-existing' })
    expect(mocks.requireMirroredAccess).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' })
    )
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })

  it('prepares one workspace accounts container for member setup using the existing operation', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueTableRows(knowledgeBase, [{ id: 'kb-existing' }])
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive', accessMode: 'members' },
      })
    ).resolves.toEqual({ knowledgeBaseId: 'kb-existing', credentialGroupId: 'accounts-group' })
    expect(mocks.ensureAccounts).toHaveBeenCalledWith(
      { kind: 'workspace', workspaceId: 'workspace-1' },
      'user-1'
    )
    expect(mocks.requireMirroredAccess).not.toHaveBeenCalled()
  })

  it('requires an administrator before preparing a managed source', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'gitlab' },
      })
    ).rejects.toThrow()
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })

  it('refuses unsupported source capabilities before creating an index', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'confluence' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })

  it('tells a reader to ask an admin when the source has no connector yet', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueConnectorLookups(null)

    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('Ask a workspace admin to connect Google Drive first'),
    })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('refuses before creating anything when per-member access is unavailable', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.isMemberAccessAvailable.mockResolvedValue(false)
    queueConnectorLookups(null)

    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('lets an admin create the base and the connector with the setup fields, then enrolls them', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueTableRows(knowledgeBase, [])
    queueTableRows(knowledgeBase, [{ id: 'kb-new' }])
    queueConnectorLookups(null, null, {
      knowledgeBaseId: 'kb-new',
      connectorId: 'connector-new',
    } as typeof existingConnector)

    const result = await connectSimSearchConnector.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        connectorType: 'confluence',
        sourceConfig: { spaceKey: 'ENG' },
      },
    })

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.deleteConnector).not.toHaveBeenCalled()

    expect(mocks.createKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({ workspaceId: 'workspace-1', name: 'Sim Search' }),
      })
    )
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({
          knowledgeBaseId: 'kb-new',
          assertedWorkspaceId: 'workspace-1',
          connectorType: 'confluence',
          sourceConfig: { spaceKey: 'ENG' },
          accessMode: 'members',
        }),
      })
    )
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(result).toEqual({
      knowledgeBaseId: 'kb-new',
      connectorId: 'connector-new',
      url: 'https://sim.test/enroll/token',
    })
  })

  it('refuses a first connect that leaves a setup field empty', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueConnectorLookups(null)

    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'confluence' },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Confluence needs a space key to connect',
    })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })

  it('reuses the connector another first connect created while it waited', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueConnectorLookups(null, existingConnector)
    queueTableRows(knowledgeBase, [{ id: existingConnector.knowledgeBaseId }])

    const result = await connectSimSearchConnector.execute({
      principal,
      input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
    })

    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
    expect(result).toEqual({ ...existingConnector, url: 'https://sim.test/enroll/token' })
  })

  it('uses the source returned by transaction-level creation reuse without deleting another source', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.createKnowledgeBase.mockRejectedValueOnce(new Error('Duplicate knowledge base name'))
    mocks.createConnector.mockResolvedValueOnce({
      connector: { id: existingConnector.connectorId },
      reused: true,
    })
    queueTableRows(knowledgeBase, [])
    queueTableRows(knowledgeBase, [{ id: existingConnector.knowledgeBaseId }])
    queueConnectorLookups(null, null)
    const result = await connectSimSearchConnector.execute({
      principal,
      input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
    })
    expect(mocks.deleteConnector).not.toHaveBeenCalled()
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ reuseSearchSource: true }),
      })
    )
    expect(result).toEqual({ ...existingConnector, url: 'https://sim.test/enroll/token' })
  })

  it('selects the matching configured source instead of the oldest source of its provider', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, [
      { ...existingConnector, connectorId: 'space-ops', sourceConfig: { spaceKey: 'OPS' } },
      { ...existingConnector, connectorId: 'space-eng', sourceConfig: { spaceKey: 'ENG' } },
    ])
    const result = await connectSimSearchConnector.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        connectorType: 'confluence',
        sourceConfig: { spaceKey: 'ENG' },
      },
    })
    expect(result.connectorId).toBe('space-eng')
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('requires an explicit source when legacy duplicate settings make selection ambiguous', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, [
      { ...existingConnector, connectorId: 'one', sourceConfig: {} },
      { ...existingConnector, connectorId: 'two', sourceConfig: {} },
    ])
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('joins an explicitly selected source without replacing its settings', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, [
      { ...existingConnector, sourceConfig: { spaceKey: 'OPS' } },
    ])
    const result = await connectSimSearchConnector.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        connectorType: 'confluence',
        connectorId: existingConnector.connectorId,
      },
    })
    expect(result.connectorId).toBe(existingConnector.connectorId)
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing or outside the canonical index', rows: [], config: undefined },
    {
      name: 'different settings',
      rows: [{ ...existingConnector, sourceConfig: { spaceKey: 'OPS' } }],
      config: { spaceKey: 'ENG' },
    },
  ])('rejects an explicitly selected source that is $name', async ({ rows, config }) => {
    mocks.resolvePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, rows)
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          connectorType: 'confluence',
          connectorId: existingConnector.connectorId,
          sourceConfig: config,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.enroll).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('keeps GitLab custom-instance PAT setup on the administrative source path', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          connectorType: 'gitlab',
          sourceConfig: { host: 'gitlab.internal.example', project: 'team/repo' },
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
})

describe('organization Search setup', () => {
  const owner = { organizationId: 'org-1' }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveWorkspace.mockResolvedValue(owner)
    mocks.isMemberAccessAvailable.mockResolvedValue(true)
    mocks.ensureAccounts.mockResolvedValue({ id: 'org-accounts' })
    mocks.createOrganizationKnowledgeBase.mockResolvedValue({ id: 'org-index' })
    mocks.enroll.mockResolvedValue({ url: 'https://fixture.test/enroll' })
  })
  function asRole(role: string) {
    for (let i = 0; i < 4; i++) queueTableRows(member, [{ role }])
  }
  it('lets an admin prepare an organization source with no workspace creation or membership', async () => {
    asRole('admin')
    queueTableRows(knowledgeBase, [])
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive', accessMode: 'members' },
      })
    ).resolves.toEqual({ knowledgeBaseId: 'org-index', credentialGroupId: 'org-accounts' })
    expect(mocks.ensureAccounts).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: 'org-1' },
      'user-1'
    )
    expect(mocks.createOrganizationKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', userId: 'user-1', isSearchIndex: true }),
      expect.any(String)
    )
    expect(mocks.createOrganizationKnowledgeBase.mock.calls[0][0]).not.toHaveProperty('workspaceId')
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })
  it('lets a member connect to an existing organization source without configuring a second crawler', async () => {
    asRole('member')
    queueConnectorLookups(existingConnector)
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).resolves.toMatchObject(existingConnector)
    expect(mocks.enroll).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({
          assertedOrganizationId: 'org-1',
          connectorId: 'connector-drive',
        }),
      })
    )
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })
  it('lets an approved member create a personal source without impersonating an admin', async () => {
    asRole('member')
    queueTableRows(knowledgeBase, [])
    mocks.createApprovedSource.mockResolvedValue({ connector: { id: 'approved-source' } })
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).resolves.toMatchObject({ knowledgeBaseId: 'org-index', connectorId: 'approved-source' })
    expect(mocks.requireApproval).toHaveBeenCalledWith('org-1', 'google_drive')
    expect(mocks.createApprovedSource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: {
          knowledgeBaseId: 'org-index',
          assertedOrganizationId: 'org-1',
          connectorType: 'google_drive',
          sourceConfig: {},
        },
      })
    )
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })
  it('refuses unapproved members before provisioning anything', async () => {
    asRole('member')
    mocks.requireApproval.mockRejectedValueOnce(new Error('Approval required'))
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).rejects.toThrow('Approval required')
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it('refuses organization source setup by a member before provisioning accounts or an index', async () => {
    asRole('member')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive', accessMode: 'members' },
      })
    ).rejects.toThrow('administrator')
    expect(mocks.ensureAccounts).not.toHaveBeenCalled()
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
  })
  it('refuses a former organization member before looking up any configured source', async () => {
    queueTableRows(member, [])
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).rejects.toThrow('Organization not found')
    expect(mocks.enroll).not.toHaveBeenCalled()
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
  })
})
