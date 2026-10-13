import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  readBounds: vi.fn(),
  readSegments: vi.fn(),
  resolveFolderScope: vi.fn(),
  folderCondition: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/logs/stats-queries', () => ({
  readLogStatsBounds: hoisted.readBounds,
  readLogStatsSegments: hoisted.readSegments,
}))

vi.mock('@/lib/logs/folder-scope', () => ({
  resolveLogFolderScope: hoisted.resolveFolderScope,
  folderScopeCondition: hoisted.folderCondition,
  LOG_FOLDER_SCOPE_VERSION: 2,
}))

vi.mock('@sim/audit', () => auditMock)

import { getLogStats } from '@/lib/logs/application/get-log-stats'

const mocks = {
  recordAudit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
}

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const workspacePrincipal = createWorkspaceApiKeyPrincipal()

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
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.readBounds.mockResolvedValue({
      minTime: '2026-08-06T00:00:00.000Z',
      maxTime: '2026-08-06T01:00:00.000Z',
    })
    mocks.readSegments.mockResolvedValue([segmentRow('workflow-1')])
    mocks.resolveFolderScope.mockResolvedValue({ includesRoot: false, folderIds: ['folder-1'] })
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

  it('publishes only the buckets that hold a run unless the caller asks for empties', async () => {
    const sparse = await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 4 },
    })
    expect(sparse.stats.aggregateSegments).toHaveLength(1)
    expect(sparse.stats.workflows[0].segments).toHaveLength(1)
    expect(sparse.stats.totalRuns).toBe(2)

    const dense = await getLogStats.execute({
      principal: workspacePrincipal,
      input: { workspaceId: 'workspace-1', filters: {}, segmentCount: 4, includeEmpty: true },
    })
    expect(dense.stats.aggregateSegments).toHaveLength(4)
    expect(dense.stats.workflows[0].segments).toHaveLength(4)
    expect(dense.stats.totalRuns).toBe(2)
  })

  /**
   * The wiring, not the arithmetic: `resolveLogStatsWindow` is exercised for
   * real here, so a requested window that never reaches it shows up as both a
   * wrong segment origin on the read and a wrong `timeBounds` on the response.
   */
  it('spans the requested window rather than the rows that happen to exist', async () => {
    const { stats } = await getLogStats.execute({
      principal: workspacePrincipal,
      input: {
        workspaceId: 'workspace-1',
        filters: {
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-08-02T00:00:00.000Z'),
        },
        segmentCount: 2,
      },
    })

    expect(mocks.readSegments).toHaveBeenCalledWith(
      expect.anything(),
      '2026-08-01T00:00:00.000Z',
      12 * 60 * 60 * 1000,
      { countHandledErrors: false }
    )
    expect(stats.timeBounds).toEqual({
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-02T00:00:00.000Z',
    })
    expect(stats.segmentMs).toBe(12 * 60 * 60 * 1000)
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
})
