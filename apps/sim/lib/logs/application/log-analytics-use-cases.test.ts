/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  readBounds: vi.fn(),
  readSegments: vi.fn(),
  resolveFolderScope: vi.fn(),
  folderCondition: vi.fn(),
  queryLogs: vi.fn(),
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

vi.mock('@/lib/logs/stats-queries', () => ({
  readLogStatsBounds: mocks.readBounds,
  readLogStatsSegments: mocks.readSegments,
}))

vi.mock('@/lib/logs/folder-scope', () => ({
  resolveLogFolderScope: mocks.resolveFolderScope,
  folderScopeCondition: mocks.folderCondition,
  LOG_FOLDER_SCOPE_VERSION: 2,
}))

vi.mock('@/lib/logs/public-queries', () => ({
  queryPublicWorkflowLogs: mocks.queryLogs,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getLogStats } from '@/lib/logs/application/get-log-stats'
import { queryPublicLogs } from '@/lib/logs/application/query-public-logs'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}
const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}

function segmentRow(workflowId: string) {
  return {
    workflowId,
    workflowName: workflowId,
    segmentIndex: 0,
    totalExecutions: 2,
    successfulExecutions: 1,
    avgDurationMs: 100,
  }
}

describe('getLogStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.readBounds.mockResolvedValue({
      minTime: '2026-08-06T00:00:00.000Z',
      maxTime: '2026-08-06T01:00:00.000Z',
    })
    mocks.readSegments.mockResolvedValue([segmentRow('workflow-1')])
    mocks.resolveFolderScope.mockResolvedValue({ includesRoot: false, folderIds: ['folder-1'] })
  })

  it('rejects a principal kind the operation does not accept before reading anything', async () => {
    await expect(
      getLogStats.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 24 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.readBounds).not.toHaveBeenCalled()
    expect(mocks.readSegments).not.toHaveBeenCalled()
  })

  it('conceals a workspace that does not resolve', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      getLogStats.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 24 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.readBounds).not.toHaveBeenCalled()
  })

  it('rejects a workspace key pointed at another workspace', async () => {
    await expect(
      getLogStats.execute({
        principal: { ...workspacePrincipal, workspaceId: 'workspace-2' },
        input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 24 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.readBounds).not.toHaveBeenCalled()
  })

  it('derives the bucket width from the window before reading the segments', async () => {
    await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 2 },
    })

    expect(mocks.readSegments).toHaveBeenCalledWith(
      expect.anything(),
      '2026-08-06T00:00:00.000Z',
      expect.any(Number)
    )
  })

  it('resolves the folder scope only after authorization, and only when asked', async () => {
    await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 2 },
    })
    expect(mocks.resolveFolderScope).not.toHaveBeenCalled()

    await getLogStats.execute({
      principal: workspacePrincipal,
      input: {
        workspaceId: 'workspace-1',
        filters: {},
        folderPaths: ['/prod'],
        segmentCount: 2,
      },
    })
    expect(mocks.resolveFolderScope).toHaveBeenCalledWith('workspace-1', ['/prod'])
    expect(mocks.folderCondition).toHaveBeenCalledWith({
      includesRoot: false,
      folderIds: ['folder-1'],
    })
  })

  it('caps the per-workflow series while keeping the workspace totals exact', async () => {
    mocks.readSegments.mockResolvedValueOnce(
      Array.from({ length: 250 }, (_unused, index) => segmentRow(`workflow-${index}`))
    )

    const { stats, workflowsTruncated } = await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 1 },
    })

    expect(workflowsTruncated).toBe(true)
    expect(stats.workflows).toHaveLength(200)
    expect(stats.totalRuns).toBe(500)
  })

  it('records no audit for a read', async () => {
    await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 2 },
    })

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates infrastructure failures instead of turning them into a not-found', async () => {
    const failure = new Error('replica unavailable')
    mocks.readBounds.mockRejectedValueOnce(failure)

    await expect(
      getLogStats.execute({
        principal: workspacePrincipal,
        input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 2 },
      })
    ).rejects.toBe(failure)
  })
})

describe('queryPublicLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.queryLogs.mockResolvedValue({ data: [{ id: 'log-1' }], nextCursorKeys: null })
    mocks.resolveFolderScope.mockResolvedValue({ includesRoot: false, folderIds: ['folder-1'] })
  })

  const input = {
    workspaceId: 'workspace-1',
    filters: {},
    sortBy: 'cost' as const,
    sortOrder: 'desc' as const,
    cursorKeys: undefined,
    limit: 50,
  }

  it('rejects a principal kind the operation does not accept before reading anything', async () => {
    await expect(
      queryPublicLogs.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.queryLogs).not.toHaveBeenCalled()
  })

  it('conceals a workspace that does not resolve', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      queryPublicLogs.execute({ principal: workspacePrincipal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reads under the canonical workspace, not the asserted one', async () => {
    await queryPublicLogs.execute({ principal: workspacePrincipal, input })

    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { workspaceId: 'workspace-1' },
        sortBy: 'cost',
        sortOrder: 'desc',
        limit: 50,
      })
    )
  })

  it('expands a folder filter only after authorization', async () => {
    await queryPublicLogs.execute({
      principal: workspacePrincipal,
      input: { ...input, folderPaths: ['/prod'] },
    })

    expect(mocks.resolveFolderScope).toHaveBeenCalledWith('workspace-1', ['/prod'])
    expect(mocks.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ folderScope: { includesRoot: false, folderIds: ['folder-1'] } })
    )
  })

  it('returns the keyset the next page resumes from', async () => {
    mocks.queryLogs.mockResolvedValueOnce({ data: [], nextCursorKeys: ['0.41', 'log-1'] })

    const result = await queryPublicLogs.execute({ principal: workspacePrincipal, input })

    expect(result.nextCursorKeys).toEqual(['0.41', 'log-1'])
  })
})
