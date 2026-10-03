import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTableAnalytics } from '@/lib/table/application/analytics'

const hoisted = vi.hoisted(() => ({
  flag: vi.fn(),
  capability: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/dashboards/feature-flag', () => ({ requireDashboardsEnabled: hoisted.flag }))
vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  assertWorkspaceCapability: hoisted.capability,
}))
vi.mock('@/lib/table/analytics/query', () => ({ queryTableAnalytics: hoisted.query }))
vi.mock('@/lib/core/network/context.server', () => ({
  runWithOutboundOrganization: (_org: string, callback: () => unknown) => callback(),
}))
const mocks = {
  ...hoisted,
  table: tableServiceMockFns.mockGetTableById,
  workspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}
const principal = { kind: 'session' as const, userId: 'viewer', sessionId: 'session' }
const input = {
  tableId: 'tbl_test',
  assertedWorkspaceId: 'workspace_test',
  query: {
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-02T00:00:00Z',
    aggregate: { n: { op: 'count' as const } },
  },
}
beforeEach(() => {
  mocks.flag.mockResolvedValue(undefined)
  mocks.table.mockResolvedValue({
    id: 'tbl_test',
    workspaceId: 'workspace_test',
    schema: { columns: [] },
  })
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace_test',
    workspaceOrganizationId: 'org_test',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'payer',
  })
  mocks.permission.mockResolvedValue('read')
  mocks.capability.mockResolvedValue(undefined)
  mocks.query.mockResolvedValue({
    rows: [{ n: 4 }],
    columns: ['n'],
    columnLabels: { n: 'n' },
    truncated: false,
    bucket: null,
  })
})
describe('authorized table analytics', () => {
  it('rejects when dashboards are not enabled for the organization', async () => {
    mocks.flag.mockRejectedValue(new Error('Dashboards are not enabled'))
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow(
      'Dashboards are not enabled'
    )
  })

  it('returns analytics for an authorized viewer', async () => {
    expect(await readTableAnalytics.execute({ principal, input })).toHaveProperty('rows.0.n', 4)
  })
  it('rejects API keys', async () => {
    await expect(
      readTableAnalytics.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace_test', keyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    await expect(
      readTableAnalytics.execute({
        principal: { kind: 'personal_api_key', userId: 'viewer', keyId: 'key' },
        input,
      })
    ).rejects.toThrow()
  })
  it('conceals a table in another workspace and missing/archived tables', async () => {
    mocks.table.mockResolvedValueOnce({ id: 'tbl_test', workspaceId: 'other' })
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('not found')
    mocks.table.mockResolvedValueOnce(null)
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('not found')
  })
  it('rejects without membership or the tables capability', async () => {
    mocks.permission.mockResolvedValueOnce(null)
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('Insufficient')
    mocks.capability.mockRejectedValueOnce(new Error('Tables disabled'))
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow(
      'Tables disabled'
    )
  })
  it('rejects invalid domain input and propagates infrastructure errors', async () => {
    await expect(
      readTableAnalytics.execute({
        principal,
        input: { ...input, query: { ...input.query, to: input.query.from } },
      })
    ).rejects.toThrow('from must')
    mocks.query.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow(
      'Database unavailable'
    )
  })
})
