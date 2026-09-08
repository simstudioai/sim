/** @vitest-environment node */
import { knowledgeConnector, member, organizationSearchIntegration } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: mocks.context,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => ['owner', 'admin'].includes(role),
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_SOURCE_TYPES: [
    ['gmail', { name: 'Gmail' }],
    ['google_drive', { name: 'Google Drive' }],
  ],
}))

import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'

const principal = { kind: 'session', sessionId: 'session', userId: 'actor' } as const
const input = { organizationId: 'organization', connectorType: 'gmail', approved: true }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.context.mockResolvedValue({ organizationId: input.organizationId })
})

describe('organization Search approval', () => {
  it.each(['owner', 'admin'])(
    'allows %s approval without creating sources, credentials or an index',
    async (role) => {
      queueTableRows(member, [{ role }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ connectorType: 'gmail' }])
      await expect(approveSearchIntegration.execute({ principal, input })).resolves.toMatchObject({
        approved: true,
        changed: true,
      })
      expect(dbChainMockFns.insert).toHaveBeenCalledExactlyOnceWith(organizationSearchIntegration)
      expect(dbChainMockFns.values).toHaveBeenCalledWith({
        organizationId: 'organization',
        connectorType: 'gmail',
        approved: true,
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          metadata: expect.objectContaining({ organizationId: 'organization', approved: true }),
        })
      )
    }
  )

  it.each([
    { rows: [{ role: 'member' }], code: 'forbidden' },
    { rows: [], code: 'not_found' },
  ])('refuses unauthorized approval with $code', async ({ rows, code }) => {
    queueTableRows(member, rows)
    await expect(approveSearchIntegration.execute({ principal, input })).rejects.toMatchObject({
      code,
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects unsupported principal kinds before canonical loading', async () => {
    await expect(
      approveSearchIntegration.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', apiKeyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('rejects unknown integration types', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    await expect(
      approveSearchIntegration.execute({ principal, input: { ...input, connectorType: 'unknown' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not emit audit for an unchanged decision', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(organizationSearchIntegration, [])
    await expect(approveSearchIntegration.execute({ principal, input })).resolves.toMatchObject({
      changed: false,
    })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves existing sources while an explicit deactivation overrides them', async () => {
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(organizationSearchIntegration, [{ connectorType: 'gmail', approved: false }])
    queueTableRows(knowledgeConnector, [
      { connectorType: 'gmail' },
      { connectorType: 'google_drive' },
    ])
    await expect(
      listSearchIntegrations.execute({ principal, input: { organizationId: 'organization' } })
    ).resolves.toEqual([
      { connectorType: 'gmail', approved: false },
      { connectorType: 'google_drive', approved: true },
    ])
  })
})
