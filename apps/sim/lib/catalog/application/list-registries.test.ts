/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mocks.recordAudit,
  AuditAction: {},
  AuditResourceType: {},
}))

import { listCatalogConnectorTypes } from '@/lib/catalog/application/list-connector-types'

const WORKSPACE_ID = 'workspace-1'
const session: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

describe('connector-type catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('read')
  })

  const fullPage = { detail: 'full' as const, limit: 100, offset: 0 }

  it('returns the whole connector-type registry and records no audit', async () => {
    const { entries, hasMore } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, ...fullPage },
    })

    expect(entries.length).toBeGreaterThan(10)
    expect(hasMore).toBe(false)
    expect(entries.every((entry) => typeof entry.connectorType === 'string')).toBe(true)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('publishes the multi and canonical-pair config properties a caller cannot infer', async () => {
    const { entries } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, ...fullPage },
    })

    const fields = entries.flatMap((entry) => ('configFields' in entry ? entry.configFields : []))
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.some((field) => field.multi === true)).toBe(true)
    expect(fields.some((field) => typeof field.canonicalParamId === 'string')).toBe(true)
    expect(fields.every((field) => !Object.hasOwn(field, 'icon'))).toBe(true)
  })

  /**
   * Sixty-odd types with their whole config schema is well over 100 KB for a
   * caller that only needs to pick one. The default projection is what that
   * decision takes; `detail=full` is where the schema lives.
   */
  it('projects a summary without the config schema unless detail=full is asked for', async () => {
    const { entries } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: {
        workspaceId: WORKSPACE_ID,
        search: 'notion',
        detail: 'summary',
        limit: 25,
        offset: 0,
      },
    })

    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]).sort()).toEqual(['auth', 'connectorType', 'description', 'name'])
    expect(entries[0]).toMatchObject({ connectorType: 'notion', auth: { mode: 'oauth' } })
  })

  it('pages the registry from an offset', async () => {
    const first = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, detail: 'summary', limit: 1, offset: 0 },
    })
    const second = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, detail: 'summary', limit: 1, offset: 1 },
    })

    expect(first).toMatchObject({ offset: 0, limit: 1, hasMore: true })
    expect(second.entries).toHaveLength(1)
    expect(second.entries[0].connectorType).not.toBe(first.entries[0].connectorType)
  })

  it('searches connector names case-insensitively', async () => {
    const { entries } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, search: 'noTIon', ...fullPage },
    })

    expect(entries.map((entry) => entry.connectorType)).toEqual(['notion'])
  })

  it('answers not found for a workspace the caller cannot reach', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, ...fullPage },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })

  it('rejects a blank search rather than silently matching everything', async () => {
    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, search: ' ', ...fullPage },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'search cannot be empty' })
  })
})
