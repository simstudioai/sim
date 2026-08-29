/**
 * @vitest-environment node
 */

import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readLogs: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getUserPermissionConfig: vi.fn(),
}))

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

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

import { listLogsUseCase } from '@/lib/logs/application/list-logs'

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
    mocks.getUserPermissionConfig.mockResolvedValue(null)
  })

  /**
   * A cost withheld on the detail but still printed on the list withholds
   * nothing, so the same key has to reach both queries.
   */
  it('tells the list query to withhold spend when the group does', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ hideCostInfo: true })

    await listLogsUseCase.execute({ principal: SESSION, input: INPUT })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: true }))
  })

  it('leaves spend in place when no group withholds it', async () => {
    await listLogsUseCase.execute({ principal: SESSION, input: INPUT })

    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
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

    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalled()
    expect(mocks.readLogs).toHaveBeenCalledWith(expect.objectContaining({ hideCostInfo: false }))
  })
})
