/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  resolveDefaultOrganization: vi.fn(),
  getOrgWorkspaceIds: vi.fn(),
  buildOrgScopeCondition: vi.fn(),
  buildFilterConditions: vi.fn(),
  decodeAuditLogCursor: vi.fn(),
  queryAuditLogs: vi.fn(),
  recordAudit: vi.fn(),
  isCapabilityWithheldForUser: vi.fn(),
}))

vi.mock('@/lib/permission-groups/user-scope.server', () => ({
  isCapabilityWithheldForUser: mocks.isCapabilityWithheldForUser,
}))

vi.mock('@/lib/audit-logs/authorization', () => ({
  resolveEnterpriseAuditAccess: mocks.resolveAccess,
  resolveDefaultAuditOrganization: mocks.resolveDefaultOrganization,
}))

vi.mock('@/lib/audit-logs/query', () => ({
  getOrgWorkspaceIds: mocks.getOrgWorkspaceIds,
  buildOrgScopeCondition: mocks.buildOrgScopeCondition,
  buildFilterConditions: mocks.buildFilterConditions,
  decodeAuditLogCursor: mocks.decodeAuditLogCursor,
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
    mocks.isCapabilityWithheldForUser.mockResolvedValue(false)
    mocks.resolveDefaultOrganization.mockResolvedValue({
      kind: 'resolved',
      organizationId: 'organization-1',
    })
    mocks.resolveAccess.mockResolvedValue({
      success: true,
      context: { organizationId: 'organization-1', orgMemberIds: ['admin-1'] },
    })
    mocks.getOrgWorkspaceIds.mockResolvedValue(['workspace-1'])
    mocks.buildOrgScopeCondition.mockReturnValue({ type: 'scope' })
    mocks.buildFilterConditions.mockReturnValue([])
    mocks.decodeAuditLogCursor.mockReturnValue({
      createdAt: '2026-01-01T00:00:00.000Z',
      id: 'audit-1',
    })
    mocks.queryAuditLogs.mockResolvedValue({ data: [], nextCursor: undefined })
  })

  it('rejects workspace keys before organization membership is loaded', async () => {
    await expect(
      listAuditLogs.execute({ principal: workspacePrincipal, input: listInput })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveAccess).not.toHaveBeenCalled()
    expect(mocks.queryAuditLogs).not.toHaveBeenCalled()
  })

  it('rejects an OAuth grant without API access before organization membership is loaded', async () => {
    const principal = {
      kind: 'oauth_access_token',
      userId: 'admin-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['offline_access'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } as const

    await expect(listAuditLogs.execute({ principal, input: listInput })).rejects.toMatchObject({
      requiredScope: 'api:read',
    })
    expect(mocks.resolveAccess).not.toHaveBeenCalled()
    expect(mocks.resolveDefaultOrganization).not.toHaveBeenCalled()
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

  it.each(['sim-cli', 'partner-app'])(
    'rechecks the organization OAuth restriction for an existing %s audit token',
    async (clientId) => {
      const principal = {
        kind: 'oauth_access_token',
        userId: 'admin-1',
        clientId,
        tokenId: 'token-1',
        scopes: ['api:read'],
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      } as const
      await expect(listAuditLogs.execute({ principal, input: listInput })).resolves.toEqual({
        data: [],
        nextCursor: undefined,
      })
      mocks.queryAuditLogs.mockClear()
      mocks.isCapabilityWithheldForUser.mockImplementation(
        async (_userId: string, capability: string) => capability === 'oauth_apps.use'
      )
      await expect(
        listAuditLogs.execute({ principal, input: { ...listInput, organizationId: undefined } })
      ).rejects.toMatchObject({ capability: 'oauth_apps.use' })
      expect(mocks.isCapabilityWithheldForUser).toHaveBeenCalledWith('admin-1', 'oauth_apps.use')
      expect(mocks.queryAuditLogs).not.toHaveBeenCalled()
    }
  )

  it('keeps audit sessions and personal API keys independent of the OAuth app restriction', async () => {
    mocks.isCapabilityWithheldForUser.mockImplementation(
      async (_userId: string, capability: string) => capability === 'oauth_apps.use'
    )
    await expect(
      listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })
    ).resolves.toBeDefined()
    await expect(
      listAuditLogs.execute({
        principal: { kind: 'personal_api_key', userId: 'admin-1', keyId: 'key-1' },
        input: listInput,
      })
    ).resolves.toBeDefined()
  })

  /**
   * Nothing an API key can reach publishes an organization id, so a required
   * `organizationId` made the whole resource unreachable from a key. It is
   * derived from the caller, which `member`'s per-user unique index keeps to a
   * single candidate.
   */
  it('derives the organization when the caller named none', async () => {
    await expect(
      listAuditLogs.execute({
        principal: sessionPrincipal,
        input: { ...listInput, organizationId: undefined },
      })
    ).resolves.toEqual({ data: [], nextCursor: undefined })

    expect(mocks.resolveDefaultOrganization).toHaveBeenCalledWith('admin-1')
    expect(mocks.resolveAccess).toHaveBeenCalledWith('admin-1', 'organization-1')
  })

  it('does not derive an organization the caller named itself', async () => {
    await listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })

    expect(mocks.resolveDefaultOrganization).not.toHaveBeenCalled()
  })

  it('names the membership refusal for a caller in no organization', async () => {
    mocks.resolveDefaultOrganization.mockResolvedValueOnce({ kind: 'none' })

    await expect(
      getAuditLog.execute({
        principal: sessionPrincipal,
        input: { id: 'audit-1' },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'ORGANIZATION_MEMBERSHIP_REQUIRED',
    })

    expect(mocks.resolveAccess).not.toHaveBeenCalled()
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

  it('rejects a malformed cursor instead of restarting at page one', async () => {
    mocks.decodeAuditLogCursor.mockReturnValueOnce(null)

    await expect(
      listAuditLogs.execute({
        principal: sessionPrincipal,
        input: { ...listInput, cursor: 'not-a-cursor' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Invalid audit-log cursor' })

    expect(mocks.getOrgWorkspaceIds).not.toHaveBeenCalled()
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

  /**
   * The resolver distinguishes four refusals with four different remedies. They
   * share a status and are indistinguishable to a client that cannot branch on
   * prose, so each has to arrive with its own `detailCode`.
   */
  it.each([
    ['ORGANIZATION_MEMBERSHIP_REQUIRED', 'Not a member of the requested organization'],
    ['ORGANIZATION_ADMIN_REQUIRED', 'Organization admin or owner role required'],
    ['ENTERPRISE_PLAN_REQUIRED', 'Active enterprise subscription required'],
    ['AUDIT_LOGS_DISABLED', 'Audit logs are disabled.'],
  ] as const)('carries the %s refusal cause through the use case', async (code, message) => {
    mocks.resolveAccess.mockResolvedValueOnce({ success: false, status: 403, code, message })

    await expect(
      listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })
    ).rejects.toMatchObject({ code: 'forbidden', detailCode: code, message })
  })

  it('names the principal-kind refusal too', async () => {
    await expect(
      listAuditLogs.execute({ principal: workspacePrincipal, input: listInput })
    ).rejects.toMatchObject({ code: 'forbidden', detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
  })

  it('propagates organization-store failures', async () => {
    const failure = new Error('database unavailable')
    mocks.resolveAccess.mockRejectedValueOnce(failure)

    await expect(
      listAuditLogs.execute({ principal: sessionPrincipal, input: listInput })
    ).rejects.toBe(failure)
  })
})
