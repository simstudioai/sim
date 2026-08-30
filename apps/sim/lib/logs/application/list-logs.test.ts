/**
 * @vitest-environment node
 */

import type { Principal } from '@sim/auth/principal'
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readLogs: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/logs/list-logs', () => ({
  readLogs: mocks.readLogs,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (held: string | null, required: string) =>
    held === 'admin' || held === required || (held === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { listLogsUseCase } from '@/lib/logs/application/list-logs'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const WORKSPACE_ID = 'workspace-1'
const SESSION: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const INPUT = { workspaceId: WORKSPACE_ID, limit: 100, sortBy: 'date', sortOrder: 'desc' } as never

describe('listLogsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('leaves spend in place when no group withholds it', async () => {
    await listLogsUseCase.execute({ principal: SESSION, input: INPUT })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
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

  it('answers the same cost query when no group withholds spend', async () => {
    await listLogsUseCase.execute({
      principal: SESSION,
      input: { ...(INPUT as object), sortBy: 'cost', costOperator: '>', costValue: 0.5 } as never,
    })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'cost' }))
  })

  /** A duration filter names nothing the group withholds, so it still answers. */
  it('leaves a duration filter alone under a spend-withholding group', async () => {
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    await listLogsUseCase.execute({
      principal: SESSION,
      input: { ...(INPUT as object), durationOperator: '>', durationValue: 100 } as never,
    })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: true }))
  })

  /**
   * An actorless run has no user, so there is no group to resolve — it reads its
   * own workspace's logs whole rather than being handed a stand-in viewer.
   */
  it('does not resolve a group for a principal with no subject', async () => {
    await listLogsUseCase.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: WORKSPACE_ID,
        keyId: 'key-1',
      } as Principal,
      input: INPUT,
    })

    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
  })
})
