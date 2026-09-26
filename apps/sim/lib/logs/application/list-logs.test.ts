import type { Principal } from '@sim/auth/principal'
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  readLogs: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/logs/list-logs', () => ({
  readLogs: hoisted.readLogs,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { listLogsUseCase } from '@/lib/logs/application/list-logs'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const mocks = {
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  ...hoisted,
  resolveWorkspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const WORKSPACE_ID = 'workspace-1'
const SESSION: Principal = createSessionPrincipal()
const INPUT = { workspaceId: WORKSPACE_ID, limit: 100, sortBy: 'date', sortOrder: 'desc' } as never

describe('listLogsUseCase', () => {
  beforeEach(() => {
    mocks.resolveWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.readLogs.mockResolvedValue({ data: [], nextCursor: null })
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  /**
   * A cost withheld on the detail but still printed on the list withholds
   * nothing, so the same key has to reach both queries.
   */
  it('tells the list query to withhold spend when the group does', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    await listLogsUseCase.execute({ principal: SESSION, input: INPUT })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: true }))
  })

  /**
   * Blanking the field is not enough on its own: `cost > X` answered faithfully
   * is a bisection oracle over the very number that was withheld, and the sort
   * leaks the same ranking more slowly.
   */
  it.each([
    ['a cost sort', { sortBy: 'cost' }],
    ['a cost filter', { costOperator: '>', costValue: 0.5 }],
    ['an equality cost filter', { costOperator: '=', costValue: 0 }],
  ])('refuses %s when the group withholds spend', async (_label, overrides) => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    await expect(
      listLogsUseCase.execute({
        principal: SESSION,
        input: { ...(INPUT as object), ...overrides } as never,
      })
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    expect(mocks.readLogs).not.toHaveBeenCalled()
  })

  /**
   * An actorless run has no user, so there is no group to resolve — it reads its
   * own workspace's logs whole rather than being handed a stand-in viewer.
   */
  it('does not resolve a group for a principal with no subject', async () => {
    await listLogsUseCase.execute({
      principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }) as Principal,
      input: INPUT,
    })

    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
  })

  /**
   * An executor delegation names the person who triggered the run, but carries
   * their role and none of their capabilities — the exemption the authorization
   * funnel already applied on the way in. Projecting on them here would be a
   * second, contrary decision about the same principal, and a cost-sorted read
   * would not merely lose a column: `assertLogCostQueryAllowed` would refuse the
   * run's own listing outright.
   */
  it('reads whole for a run delegated by a member whose group withholds spend', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    await listLogsUseCase.execute({
      principal: createExecutorPrincipal({
        workspaceId: WORKSPACE_ID,
        audience: 'sim:logs',
        expiresAt: new Date('2999-01-01T00:00:00Z'),
      }) as Principal,
      input: { ...(INPUT as object), sortBy: 'cost' } as never,
    })

    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
  })
})
