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

  it('passes the personal-key subject through as the projection reader', async () => {
    await getPublicLog.execute({
      principal: { kind: 'personal_api_key', userId: 'user-9', keyId: 'key-9' },
      input: { runId: 'run-1' },
    })

    expect(mocks.materialize).toHaveBeenCalledWith(
      { pointer: true },
      expect.objectContaining({ userId: 'user-9' })
    )
  })

  it('projects listed runs for display when trace spans are requested', async () => {
    await listPublicLogs.execute({
      principal: { kind: 'personal_api_key', userId: 'user-9', keyId: 'key-9' },
      input: {
        workspaceId: 'workspace-1',
        filters: {},
        limit: 50,
        includeFullDetails: false,
        includeFinalOutput: false,
        includeTraceSpans: true,
      },
    })

    expect(mocks.materialize).toHaveBeenCalledWith(
      { pointer: true },
      expect.objectContaining({ executionId: 'run-1', userId: 'user-9' })
    )
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
