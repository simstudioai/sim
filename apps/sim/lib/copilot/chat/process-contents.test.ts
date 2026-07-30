/**
 * @vitest-environment node
 */

import { dbChainMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

const { discoverServerTools, getSkillById, getWorkspaceFile, getTableById, getRowsByIds } =
  vi.hoisted(() => ({
    discoverServerTools: vi.fn(),
    getSkillById: vi.fn(),
    getWorkspaceFile: vi.fn(),
    getTableById: vi.fn(),
    getRowsByIds: vi.fn(),
  }))

vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById }))
vi.mock('@/lib/mcp/service', () => ({ mcpService: { discoverServerTools } }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({ getWorkspaceFile }))
vi.mock('@/lib/table/service', () => ({ getTableById }))
vi.mock('@/lib/table/rows/service', () => ({ getRowsByIds }))

/**
 * Overrides the global `@sim/db` mock: the logs-context tests below need
 * controllable row data, which the stable `dbChainMockFns.limit` provides.
 */

import { processContextsServer } from './process-contents'

describe('processContextsServer - skill contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a tagged skill to full content + encoded VFS path', async () => {
    getSkillById.mockResolvedValue({
      id: 'sk-1',
      name: 'My Skill — PostHog',
      description: 'desc',
      content: '# My Skill\n\nDo the thing.',
    })

    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'sk-1', label: 'My Skill — PostHog' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(getSkillById).toHaveBeenCalledWith({ skillId: 'sk-1', workspaceId: 'ws-1' })
    expect(result).toEqual([
      {
        type: 'skill',
        tag: '@My Skill — PostHog',
        content: '# My Skill\n\nDo the thing.',
        path: 'agent/skills/My%20Skill%20%E2%80%94%20PostHog.json',
      },
    ])
  })

  it('drops a skill that does not resolve (unknown or cross-workspace)', async () => {
    getSkillById.mockResolvedValue(null)

    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'missing', label: 'x' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toEqual([])
  })

  it('drops a skill when no workspace is in scope', async () => {
    const result = await processContextsServer(
      [{ kind: 'skill', skillId: 'sk-1', label: 'x' } as ChatContext],
      'user-1',
      'hello',
      undefined
    )

    expect(getSkillById).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})

describe('processContextsServer - MCP contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists only the tools from the slash-selected MCP server', async () => {
    discoverServerTools.mockResolvedValue([
      {
        serverId: 'mcp-server-1',
        serverName: 'Docs',
        name: 'search',
        description: 'Search documentation',
        inputSchema: { type: 'object', properties: {} },
      },
    ])

    const result = await processContextsServer(
      [{ kind: 'mcp', serverId: 'mcp-server-1', label: 'Docs' }],
      'user-1',
      '/Docs find auth docs',
      'ws-1'
    )

    expect(discoverServerTools).toHaveBeenCalledWith('user-1', 'mcp-server-1', 'ws-1')
    expect(result).toEqual([
      expect.objectContaining({
        type: 'mcp',
        tag: '/Docs',
        content: expect.stringContaining('mcp-server-1-search'),
      }),
    ])
  })
})

describe('processContextsServer - logs contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a tagged run to a compact summary with a block overview, never raw input/output', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'log-1',
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        executionId: 'exec-1',
        level: 'error',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-01-01T00:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: {
          traceSpans: [
            {
              id: 'span-1',
              blockId: 'block-1',
              name: 'Agent 1',
              type: 'agent',
              status: 'failed',
              duration: 500,
              input: { prompt: 'do the thing' },
              output: { error: '429 No active subscription' },
            },
          ],
        },
        costTotal: '0.05',
        workflowName: 'My Flow',
      },
    ])
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      workflow: { workspaceId: 'ws-1' },
    })

    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'exec-1', label: 'My Flow' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('logs')
    expect(result[0].tag).toBe('@My Flow')

    const summary = JSON.parse(result[0].content)
    expect(summary).toMatchObject({
      executionId: 'exec-1',
      workflowId: 'wf-1',
      workflowName: 'My Flow',
      level: 'error',
      trigger: 'manual',
      totalDurationMs: 1000,
      cost: { total: 0.05 },
      overview: [
        {
          id: 'span-1',
          blockId: 'block-1',
          name: 'Agent 1',
          type: 'agent',
          status: 'failed',
          durationMs: 500,
        },
      ],
    })
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('do the thing')
    expect(serialized).not.toContain('429 No active subscription')
    expect(summary.note).toContain('query_logs')
    expect(summary.note).toContain('exec-1')
  })

  it('drops the overview (keeping the rest of the summary) when it exceeds the size cap', async () => {
    const traceSpans = Array.from({ length: 2000 }, (_, i) => ({
      id: `span-${i}`,
      blockId: `block-${i}`,
      name: `Block ${i}`,
      type: 'agent',
      status: 'success',
      duration: 10,
    }))
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'log-1',
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        executionId: 'exec-1',
        level: 'error',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        executionData: { traceSpans },
        costTotal: null,
        workflowName: 'My Flow',
      },
    ])
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      workflow: { workspaceId: 'ws-1' },
    })

    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'exec-1', label: 'My Flow' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    const summary = JSON.parse(result[0].content)
    expect(summary.overview).toBeUndefined()
    expect(summary.executionId).toBe('exec-1')
    expect(summary.note).toContain('query_logs')
  })

  it('drops a log context when the workflow is outside the current workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'log-1',
        workflowId: 'wf-1',
        workspaceId: 'ws-other',
        executionId: 'exec-1',
        level: 'error',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        costTotal: null,
        workflowName: 'My Flow',
      },
    ])
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      workflow: { workspaceId: 'ws-other' },
    })

    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'exec-1', label: 'My Flow' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toEqual([])
  })

  it('drops a log context the user is not authorized to read', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'log-1',
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        executionId: 'exec-1',
        level: 'error',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: null,
        totalDurationMs: null,
        costTotal: null,
        workflowName: 'My Flow',
      },
    ])
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
    })

    const result = await processContextsServer(
      [{ kind: 'logs', executionId: 'exec-1', label: 'My Flow' } as ChatContext],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toEqual([])
  })
})

describe('processContextsServer - file_selection contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inlines the selected passage with its line range and a path pointer', async () => {
    getWorkspaceFile.mockResolvedValue({ name: 'notes.md', folderPath: null })

    const result = await processContextsServer(
      [
        {
          kind: 'file_selection',
          fileId: 'file-1',
          label: 'notes.md:12-14',
          text: 'the exact passage',
          startLine: 12,
          endLine: 14,
        } as ChatContext,
      ],
      'user-1',
      'explain this',
      'ws-1'
    )

    expect(getWorkspaceFile).toHaveBeenCalledWith('ws-1', 'file-1')
    expect(result).toHaveLength(1)
    const [ctx] = result
    expect(ctx.type).toBe('file_selection')
    expect(ctx.tag).toBe('@notes.md:12-14')
    expect(ctx.content).toContain('lines 12-14')
    expect(ctx.content).toContain('the exact passage')
    expect(ctx.path).toBeTruthy()
  })

  it('drops the selection when the file does not resolve', async () => {
    getWorkspaceFile.mockResolvedValue(null)

    const result = await processContextsServer(
      [
        {
          kind: 'file_selection',
          fileId: 'missing',
          label: 'x',
          text: 'anything',
        } as ChatContext,
      ],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(result).toEqual([])
  })

  it('widens the code fence so an embedded ``` block cannot close it early', async () => {
    getWorkspaceFile.mockResolvedValue({ name: 'readme.md', folderPath: null })

    const snippet = 'before\n```ts\nconst x = 1\n```\nafter'
    const result = await processContextsServer(
      [
        {
          kind: 'file_selection',
          fileId: 'file-1',
          label: 'readme.md:1-5',
          text: snippet,
          startLine: 1,
          endLine: 5,
        } as ChatContext,
      ],
      'user-1',
      'explain',
      'ws-1'
    )

    const [ctx] = result
    // Outer fence must be longer than the embedded ``` run, and the full snippet
    // (including its inner fence) must survive intact.
    expect(ctx.content).toContain('````')
    expect(ctx.content).toContain(snippet)
    expect(ctx.content.startsWith('Selected passage')).toBe(true)
    expect(ctx.content.endsWith('````')).toBe(true)
  })
})

describe('processContextsServer - table_selection contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-fetches rows by id and renders a markdown table for the selected columns', async () => {
    getTableById.mockResolvedValue({
      name: 'Sales',
      workspaceId: 'ws-1',
      schema: {
        columns: [
          { id: 'c_name', name: 'Name' },
          { id: 'c_amount', name: 'Amount' },
          { id: 'c_notes', name: 'Notes' },
        ],
      },
    })
    getRowsByIds.mockResolvedValue([
      { id: 'r1', data: { c_name: 'Acme', c_amount: 100, c_notes: 'ignored' } },
      { id: 'r2', data: { c_name: 'Globex', c_amount: 250, c_notes: 'ignored' } },
    ])

    const result = await processContextsServer(
      [
        {
          kind: 'table_selection',
          tableId: 'tbl-1',
          label: 'Sales (2 rows, 2 cols)',
          rowIds: ['r1', 'r2'],
          columnIds: ['c_name', 'c_amount'],
        } as ChatContext,
      ],
      'user-1',
      'summarize',
      'ws-1'
    )

    expect(getRowsByIds).toHaveBeenCalledWith('tbl-1', ['r1', 'r2'], 'ws-1')
    expect(result).toHaveLength(1)
    const [ctx] = result
    expect(ctx.type).toBe('table_selection')
    expect(ctx.content).toContain('| Name | Amount |')
    expect(ctx.content).toContain('| Acme | 100 |')
    expect(ctx.content).toContain('| Globex | 250 |')
    // Unselected column is excluded from the cell range.
    expect(ctx.content).not.toContain('Notes')
    expect(ctx.content).not.toContain('ignored')
  })

  it('drops the selection for a cross-workspace table', async () => {
    getTableById.mockResolvedValue({
      name: 'Sales',
      workspaceId: 'other-ws',
      schema: { columns: [] },
    })

    const result = await processContextsServer(
      [
        {
          kind: 'table_selection',
          tableId: 'tbl-1',
          label: 'x',
          rowIds: ['r1'],
        } as ChatContext,
      ],
      'user-1',
      'hello',
      'ws-1'
    )

    expect(getRowsByIds).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('drops a cell range whose columns no longer resolve (never expands to full table)', async () => {
    getTableById.mockResolvedValue({
      name: 'Sales',
      workspaceId: 'ws-1',
      schema: { columns: [{ id: 'c_name', name: 'Name' }] },
    })
    getRowsByIds.mockResolvedValue([{ id: 'r1', data: { c_name: 'Acme' } }])

    const result = await processContextsServer(
      [
        {
          kind: 'table_selection',
          tableId: 'tbl-1',
          label: 'Sales (1 row, 1 col)',
          rowIds: ['r1'],
          // Column was renamed/deleted since the selection was captured.
          columnIds: ['c_deleted'],
        } as ChatContext,
      ],
      'user-1',
      'summarize',
      'ws-1'
    )

    expect(result).toEqual([])
  })
})
