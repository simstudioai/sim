/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

const { getSkillById } = vi.hoisted(() => ({ getSkillById: vi.fn() }))

vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById }))
// Overrides the global `@sim/db` mock: the logs-context tests below need
// controllable row data, which the stable dbChainMockFns.limit provides.
vi.mock('@sim/db', () => dbChainMock)

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

describe('processContextsServer - logs contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a tagged run to a compact summary pointing at query_logs, never the full trace', async () => {
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
    })
    // No raw trace/error data — the model must pull it via the tool on demand.
    expect(summary).not.toHaveProperty('traceSpans')
    expect(summary).not.toHaveProperty('errorDetails')
    expect(summary).not.toHaveProperty('executionData')
    expect(summary.note).toContain('query_logs')
    expect(summary.note).toContain('exec-1')
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
