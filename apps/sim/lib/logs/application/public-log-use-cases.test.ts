/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getLogScope: vi.fn(),
  getLog: vi.fn(),
  listLogs: vi.fn(),
  loadFolders: vi.fn(),
  materialize: vi.fn(),
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

vi.mock('@/lib/logs/public-queries', () => ({
  getPublicWorkflowLogScope: mocks.getLogScope,
  getPublicWorkflowLog: mocks.getLog,
  listPublicWorkflowLogs: mocks.listLogs,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolders,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mocks.materialize,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getPublicLog } from '@/lib/logs/application/get-public-log'
import { listPublicLogs } from '@/lib/logs/application/list-public-logs'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const log = {
  executionId: 'run-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  workflowFolderId: 'folder-1',
  workflowUserId: 'owner-1',
  workflowOwnerEmail: 'owner@example.com',
  executionData: { pointer: true },
}
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}

describe('public log application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getLogScope.mockResolvedValue({
      executionId: 'run-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    mocks.getLog.mockResolvedValue(log)
    mocks.listLogs.mockResolvedValue({ data: [log], nextCursor: null })
    mocks.loadFolders.mockResolvedValue({
      idByPath: new Map([['/agents', 'folder-1']]),
      pathById: new Map([['folder-1', '/agents']]),
    })
    mocks.materialize.mockResolvedValue({ finalOutput: { ok: true } })
  })

  it('rejects unsupported principals before resolving the run', async () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(
      getPublicLog.execute({ principal, input: { runId: 'run-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getLogScope).not.toHaveBeenCalled()
    expect(mocks.getLog).not.toHaveBeenCalled()
  })

  it('derives workspace and materialization scope from the canonical run', async () => {
    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1' },
    })

    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(mocks.getLog).toHaveBeenCalledWith(
      { column: 'executionId', value: 'run-1' },
      'workspace-1'
    )
    expect(mocks.materialize).toHaveBeenCalledWith(
      { pointer: true },
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'run-1' }
    )
    expect(result.workflowFolderPath).toBe('/agents')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects a workspace key outside the run workspace before materialization', async () => {
    await expect(
      getPublicLog.execute({
        principal: { ...workspacePrincipal, workspaceId: 'workspace-2' },
        input: { runId: 'run-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.getLog).not.toHaveBeenCalled()
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it('resolves folder paths only after workspace authorization', async () => {
    const result = await listPublicLogs.execute({
      principal: workspacePrincipal,
      input: {
        workspaceId: 'workspace-1',
        filters: {},
        folderPaths: ['/agents'],
        limit: 50,
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: false,
      },
    })

    expect(mocks.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ workspaceId: 'workspace-1', folderIds: ['folder-1'] }),
        folderScope: { includesRoot: false, folderIds: ['folder-1'] },
      })
    )
    expect(result.items).toHaveLength(1)
  })

  it('returns a typed not-found for a missing folder', async () => {
    await expect(
      listPublicLogs.execute({
        principal: workspacePrincipal,
        input: {
          workspaceId: 'workspace-1',
          filters: {},
          folderPaths: ['/missing'],
          limit: 50,
          includeFullDetails: false,
          includeFinalOutput: false,
          includeTraceSpans: false,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.listLogs).not.toHaveBeenCalled()
  })

  it('propagates run-store failures', async () => {
    const failure = new Error('database unavailable')
    mocks.getLogScope.mockRejectedValueOnce(failure)

    await expect(
      getPublicLog.execute({ principal: workspacePrincipal, input: { runId: 'run-1' } })
    ).rejects.toBe(failure)
  })
})
