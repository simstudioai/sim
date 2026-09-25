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
  readPublicLogPage: mocks.listLogs,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolders,
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
}))

/**
 * Only the display projection is exposed: these public readers must never reach
 * for raw `materializeExecutionData`, which skips resolved-secret redaction.
 */
vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: mocks.materialize,
}))

vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: ({
    tool,
  }: {
    tool: { type: string; params?: Record<string, unknown> }
  }) =>
    Object.entries(tool.params ?? {}).map(([paramId, value]) => ({
      paramId,
      authoritative: tool.type !== 'custom-tool' && tool.type !== 'mcp',
      value,
      config: {
        id: paramId,
        type: 'short-input',
        password: paramId === 'apiKey',
      },
    })),
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

/**
 * Overrides the global registry stub (which declares no sub-blocks) so the credential
 * sanitizer has real `oauth-input` and `password: true` fields to act on.
 */
vi.mock('@/blocks/registry', () => ({
  getBlock: () => ({
    name: 'Slack',
    subBlocks: [
      { id: 'credential', type: 'oauth-input' },
      { id: 'botToken', type: 'short-input', password: true },
      { id: 'envToken', type: 'short-input', password: true },
      { id: 'tools', type: 'tool-input' },
      { id: 'headers', type: 'table' },
      { id: 'channel', type: 'short-input' },
    ],
    outputs: {},
  }),
}))

import { getPublicLog } from '@/lib/logs/application/get-public-log'
import { listPublicLogs } from '@/lib/logs/application/list-public-logs'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const log = {
  kind: 'workflow' as const,
  executionId: 'run-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  /** Null exactly when the left join found no workflow row — the delete signal. */
  workflowName: 'Support triage',
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
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getLogScope.mockResolvedValue({
      executionId: 'run-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    mocks.getLog.mockResolvedValue(log)
    mocks.listLogs.mockResolvedValue({ data: [log], nextCursorKeys: null })
    mocks.loadFolders.mockResolvedValue({
      idByPath: new Map([['/agents', 'folder-1']]),
      pathById: new Map([['folder-1', '/agents']]),
    })
    mocks.materialize.mockResolvedValue({ finalOutput: { ok: true } })
  })

  it('derives workspace and materialization scope from the canonical run', async () => {
    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1' },
    })

    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(mocks.getLog).toHaveBeenCalledWith(
      { column: 'executionId', value: 'run-1' },
      'workspace-1',
      { includeWorkflowState: true }
    )
    expect(mocks.materialize).toHaveBeenCalledWith(
      { pointer: true },
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'run-1',
        userId: undefined,
      }
    )
    expect(result.workflowFolderPath).toBe('/agents')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('omits the workflow snapshot at the query and response boundary when requested', async () => {
    mocks.getLog.mockResolvedValueOnce({
      ...log,
      workflowState: { blocks: { large: { subBlocks: { code: { value: 'private' } } } } },
    })
    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1', includeWorkflowState: false },
    })

    expect(mocks.getLog).toHaveBeenCalledWith(
      { column: 'executionId', value: 'run-1' },
      'workspace-1',
      { includeWorkflowState: false }
    )
    expect(result.log.workflowState).toBeNull()
    expect(result.executionData.finalOutput).toEqual({ ok: true })
  })

  /**
   * `null` must not stand for both "at the workspace root" and "the path could
   * not be resolved" — a caller can tell neither apart nor feed it back to
   * `folderPaths`. The root is `/`, exactly as the workflow resources report it.
   */
  it('reports the workspace root as a path a folderPaths filter would accept', async () => {
    mocks.getLog.mockResolvedValueOnce({ ...log, workflowFolderId: null })

    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1' },
    })

    expect(result.workflowFolderPath).toBe('/')
  })

  it('redacts credential values from the run snapshot', async () => {
    mocks.getLog.mockResolvedValueOnce({
      ...log,
      workflowState: {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'slack',
            subBlocks: {
              credential: { id: 'credential', type: 'oauth-input', value: 'cred_9f2a' },
              botToken: { id: 'botToken', type: 'short-input', value: 'xoxb-plaintext-secret' },
              envToken: { id: 'envToken', type: 'short-input', value: '{{SLACK_TOKEN}}' },
              tools: {
                id: 'tools',
                type: 'tool-input',
                value: [
                  {
                    type: 'custom-tool',
                    params: { apiKey: 'sk-log-tool-secret', query: 'safe input' },
                  },
                ],
              },
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ Key: 'Authorization', Value: 'Bearer log-table-secret' }],
              },
              channel: { id: 'channel', type: 'short-input', value: '#general' },
            },
          },
        },
        edges: [],
      },
    })

    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1' },
    })

    const subBlocks = (
      result.log.workflowState as {
        blocks: Record<string, { subBlocks: Record<string, { value: unknown }> }>
      }
    ).blocks['block-1'].subBlocks

    expect(subBlocks.credential.value).toBeNull()
    expect(subBlocks.botToken.value).toBeNull()
    expect(subBlocks.envToken.value).toBe('{{SLACK_TOKEN}}')
    expect(subBlocks.tools.value).toEqual([
      {
        type: 'custom-tool',
        params: { apiKey: null, query: null },
      },
    ])
    expect(subBlocks.headers.value).toBeNull()
    expect(subBlocks.channel.value).toBe('#general')
    expect(JSON.stringify(subBlocks)).not.toContain('sk-log-tool-secret')
    expect(JSON.stringify(subBlocks)).not.toContain('log-table-secret')
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
        sortBy: 'startedAt' as const,
        sortOrder: 'desc' as const,
        cursorKeys: undefined,
        limit: 50,
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: false,
        includeJobRuns: false,
      },
    })

    expect(mocks.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ workspaceId: 'workspace-1' }),
        folderScope: { includesRoot: false, folderIds: ['folder-1'] },
      })
    )
    expect(result.items).toHaveLength(1)
  })

  /**
   * Every `/logs` filter answers a value nothing matches with an empty page; a
   * `404 Folder not found` here would also make the list a folder-existence
   * oracle. The scope must still reach the query: dropping the unresolved path
   * and sending no scope would return the whole workspace's logs.
   */
  it('returns an empty page for a folder path that matches nothing', async () => {
    const result = await listPublicLogs.execute({
      principal: workspacePrincipal,
      input: {
        workspaceId: 'workspace-1',
        filters: {},
        folderPaths: ['/missing'],
        sortBy: 'startedAt' as const,
        sortOrder: 'desc' as const,
        cursorKeys: undefined,
        limit: 50,
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: false,
        includeJobRuns: false,
      },
    })

    expect(mocks.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({ folderScope: { includesRoot: false, folderIds: [] } })
    )
    expect(result.nextCursorKeys).toBeNull()
  })
})
