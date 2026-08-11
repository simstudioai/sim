/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  getOrgWorkspaceIds: vi.fn(),
  buildOrgScopeCondition: vi.fn(),
  buildFilterConditions: vi.fn(),
  queryAuditLogs: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/audit-logs/authorization', () => ({
  resolveEnterpriseAuditAccess: mocks.resolveAccess,
}))

vi.mock('@/lib/audit-logs/query', () => ({
  getOrgWorkspaceIds: mocks.getOrgWorkspaceIds,
  buildOrgScopeCondition: mocks.buildOrgScopeCondition,
  buildFilterConditions: mocks.buildFilterConditions,
  queryAuditLogs: mocks.queryAuditLogs,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getAuditLog } from '@/lib/audit-logs/application/get-audit-log'
import { listAuditLogs } from '@/lib/audit-logs/application/list-audit-logs'

const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-1',
  sessionId: 'session-1',
}
const workspacePrincipal: WorkspaceApiKeyPrincipal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}
const listInput = {
  organizationId: 'organization-1',
  includeDeparted: false,
  filters: {},
  limit: 50,
}

describe('audit-log application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveAccess.mockResolvedValue({
      success: true,
      context: { organizationId: 'organization-1', orgMemberIds: ['admin-1'] },
    })
    mocks.getOrgWorkspaceIds.mockResolvedValue(['workspace-1'])
    mocks.buildOrgScopeCondition.mockReturnValue({ type: 'scope' })
    mocks.buildFilterConditions.mockReturnValue([])
    mocks.queryAuditLogs.mockResolvedValue({ data: [], nextCursor: undefined })
  })

  it('rejects workspace keys before organization membership is loaded', async () => {
    await expect(
      listAuditLogs.execute({ principal: workspacePrincipal, input: listInput })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveAccess).not.toHaveBeenCalled()
    expect(mocks.queryAuditLogs).not.toHaveBeenCalled()
  })

  it('authorizes the requested organization and scopes the query canonically', async () => {
    await expect(
      listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })
    ).resolves.toEqual({ data: [], nextCursor: undefined })

    expect(mocks.resolveAccess).toHaveBeenCalledWith('admin-1', 'organization-1')
    expect(mocks.buildOrgScopeCondition).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      orgWorkspaceIds: ['workspace-1'],
      orgMemberIds: ['admin-1'],
      includeDeparted: false,
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects a workspace filter outside the authorized organization', async () => {
    await expect(
      listAuditLogs.execute({
        principal: sessionPrincipal,
        input: { ...listInput, filters: { workspaceId: 'workspace-2' } },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.queryAuditLogs).not.toHaveBeenCalled()
  })

  it('returns a typed not-found only after applying organization scope', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      getAuditLog.execute({
        principal: sessionPrincipal,
        input: { organizationId: 'organization-1', id: 'audit-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.buildOrgScopeCondition).toHaveBeenCalled()
  })

  it('propagates organization-store failures', async () => {
    const failure = new Error('database unavailable')
    mocks.resolveAccess.mockRejectedValueOnce(failure)

    await expect(
      listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })
    ).rejects.toBe(failure)
  })
})
