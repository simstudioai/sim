/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTableAnalytics } from '@/lib/table/application/analytics'

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  table: vi.fn(),
  workspace: vi.fn(),
  permission: vi.fn(),
  capability: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/table/service', () => ({ getTableById: mocks.table }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/dashboards/feature-flag', () => ({ requireDashboardsEnabled: mocks.flag }))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    required === 'read' && ['read', 'write', 'admin'].includes(actual),
}))
vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  assertWorkspaceCapability: mocks.capability,
}))
vi.mock('@/lib/table/analytics/query', () => ({ queryTableAnalytics: mocks.query }))
vi.mock('@/lib/core/network/context.server', () => ({
  runWithOutboundOrganization: (_org: string, callback: () => unknown) => callback(),
}))
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
  vi.clearAllMocks()
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
  it('checks dashboard rollout against the canonical organization before querying', async () => {
    mocks.flag.mockRejectedValue(new Error('Dashboards are not enabled'))
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow(
      'Dashboards are not enabled'
    )
    expect(mocks.flag).toHaveBeenCalledWith('org_test')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('authorizes the current viewer and passes canonical scope to the repository', async () => {
    expect(await readTableAnalytics.execute({ principal, input })).toHaveProperty('rows.0.n', 4)
    expect(mocks.permission).toHaveBeenCalledWith(
      'viewer',
      'workspace_test',
      'org_test',
      undefined,
      expect.any(Object)
    )
    expect(mocks.capability).toHaveBeenCalledWith(
      'viewer',
      'workspace_test',
      'tables.use',
      'org_test',
      undefined
    )
    expect(mocks.query.mock.calls[0][0]).toMatchObject({
      id: 'tbl_test',
      workspaceId: 'workspace_test',
    })
  })
  it('rejects API keys and delegation before loading protected data', async () => {
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
    expect(mocks.table).not.toHaveBeenCalled()
  })
  it('conceals a table in another workspace and missing/archived tables', async () => {
    mocks.table.mockResolvedValueOnce({ id: 'tbl_test', workspaceId: 'other' })
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('not found')
    mocks.table.mockResolvedValueOnce(null)
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('not found')
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('rechecks membership and capability before querying', async () => {
    mocks.permission.mockResolvedValueOnce(null)
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow('Insufficient')
    mocks.capability.mockRejectedValueOnce(new Error('Tables disabled'))
    await expect(readTableAnalytics.execute({ principal, input })).rejects.toThrow(
      'Tables disabled'
    )
    expect(mocks.query).not.toHaveBeenCalled()
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
