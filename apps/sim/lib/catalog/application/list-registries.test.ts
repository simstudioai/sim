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

  it('returns the whole connector-type registry and records no audit', async () => {
    const { connectorTypes } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID },
    })

    expect(connectorTypes.length).toBeGreaterThan(10)
    expect(connectorTypes.every((entry) => typeof entry.connectorType === 'string')).toBe(true)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('publishes the multi and canonical-pair config properties a caller cannot infer', async () => {
    const { connectorTypes } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID },
    })

    const fields = connectorTypes.flatMap((entry) => entry.configFields)
    expect(fields.some((field) => field.multi === true)).toBe(true)
    expect(fields.some((field) => typeof field.canonicalParamId === 'string')).toBe(true)
    expect(fields.every((field) => !Object.hasOwn(field, 'icon'))).toBe(true)
  })

  it('searches connector names case-insensitively', async () => {
    const { connectorTypes } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, search: 'noTIon' },
    })

    expect(connectorTypes.map((entry) => entry.connectorType)).toEqual(['notion'])
  })

  it('answers not found for a workspace the caller cannot reach', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })

  it('rejects a blank search rather than silently matching everything', async () => {
    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, search: ' ' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'search cannot be empty' })
  })
})
