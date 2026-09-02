/**
 * @vitest-environment node
 */

import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  isMemberAccessAvailable: vi.fn(),
  createKnowledgeBase: vi.fn(),
  createConnector: vi.fn(),
  enroll: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/knowledge/access/availability', async () => {
  const { OrchestrationError } = await import('@/lib/core/orchestration/types')
  return {
    isKnowledgeMemberAccessAvailable: mocks.isMemberAccessAvailable,
    requireKnowledgeMemberAccessAvailable: async (context: { workspaceId: string }) => {
      if (await mocks.isMemberAccessAvailable(context)) return
      throw new OrchestrationError(
        'validation',
        'Per-member access is not available for this workspace'
      )
    },
  }
})

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  createKnowledgeBase: { execute: mocks.createKnowledgeBase },
}))

vi.mock('@/lib/knowledge/application/connectors', () => ({
  createKnowledgeConnector: { execute: mocks.createConnector },
}))

vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: { execute: mocks.enroll },
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
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
    google_drive: {
      name: 'Google Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [],
    },
    confluence: {
      name: 'Confluence',
      auth: { mode: 'oauth', provider: 'confluence' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [{ id: 'spaceKey', title: 'a space key', required: true }],
    },
  },
}))

import { connectSimSearchConnector } from '@/lib/knowledge/application/sim-search'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const existingConnector = { knowledgeBaseId: 'kb-search', connectorId: 'connector-drive' }

/** The first lookup runs outside the setup lock and the second inside it. */
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
    queueConnectorLookups(null, null)
    queueTableRows(knowledgeBase, [])

    const result = await connectSimSearchConnector.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        connectorType: 'confluence',
        sourceConfig: { spaceKey: 'ENG' },
      },
    })

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
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
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

  it('reuses the connector another first connect created while it waited for the lock', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    queueConnectorLookups(null, existingConnector)

    const result = await connectSimSearchConnector.execute({
      principal,
      input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
    })

    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
    expect(result).toEqual({ ...existingConnector, url: 'https://sim.test/enroll/token' })
  })
})
