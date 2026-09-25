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
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('read')
  })

  const fullPage = { detail: 'full' as const, limit: 100, offset: 0 }

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

  it('answers not found for a workspace the caller cannot reach', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, ...fullPage },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })
})
