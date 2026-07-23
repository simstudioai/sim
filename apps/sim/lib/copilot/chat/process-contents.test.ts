/**
 * @vitest-environment node
 */

import { dbChainMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

const { discoverServerTools, getSkillById } = vi.hoisted(() => ({
  discoverServerTools: vi.fn(),
  getSkillById: vi.fn(),
}))

vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById }))
vi.mock('@/lib/mcp/service', () => ({ mcpService: { discoverServerTools } }))

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
