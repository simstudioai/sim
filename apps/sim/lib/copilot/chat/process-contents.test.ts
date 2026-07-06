/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

const { getSkillById, getWorkspaceFile, resolveChatFileRecordById } = vi.hoisted(() => ({
  getSkillById: vi.fn(),
  getWorkspaceFile: vi.fn(),
  resolveChatFileRecordById: vi.fn(),
}))

vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({ getWorkspaceFile }))
vi.mock('@/lib/copilot/tools/handlers/chat-file-reader', () => ({ resolveChatFileRecordById }))
/**
 * Overrides the global `@sim/db` mock: the logs-context tests below need
 * controllable row data, which the stable `dbChainMockFns.limit` provides.
 */
vi.mock('@sim/db', () => dbChainMock)

import { processContextsServer, resolveActiveResourceContext } from './process-contents'

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

describe('resolveActiveResourceContext - file branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a workspace file to its canonical files/ path', async () => {
    getWorkspaceFile.mockResolvedValue({
      id: 'wf_shared',
      name: 'report.pdf',
      folderPath: 'Q4 Docs',
    })

    const ctx = await resolveActiveResourceContext('file', 'wf_shared', 'ws-1', 'user-1', 'chat-1')

    expect(ctx).toEqual({
      type: 'active_resource',
      tag: '@active_resource',
      content: '',
      path: 'files/Q4%20Docs/report.pdf',
    })
    expect(resolveChatFileRecordById).not.toHaveBeenCalled()
  })

  /**
   * Regression: getWorkspaceFile pins context='workspace', so an active tab
   * pointing at a chat-scoped output resolved to null and the @active_resource
   * pointer was silently dropped from the model payload — the model never saw
   * the tab the user was looking at.
   */
  it('falls back to the chat-scoped row for an output tab and emits its outputs/ path', async () => {
    getWorkspaceFile.mockResolvedValue(null)
    resolveChatFileRecordById.mockResolvedValue({
      id: 'wf_output',
      name: 'chart 1.png',
      storageContext: 'output',
    })

    const ctx = await resolveActiveResourceContext('file', 'wf_output', 'ws-1', 'user-1', 'chat-1')

    expect(resolveChatFileRecordById).toHaveBeenCalledWith('chat-1', 'wf_output')
    expect(ctx).toEqual({
      type: 'active_resource',
      tag: '@active_resource',
      content: '',
      path: 'outputs/chart%201.png',
    })
  })

  it('emits the uploads/ path for a chat upload row', async () => {
    getWorkspaceFile.mockResolvedValue(null)
    resolveChatFileRecordById.mockResolvedValue({
      id: 'wf_upload',
      name: 'photo.jpg',
      storageContext: 'mothership',
    })

    const ctx = await resolveActiveResourceContext('file', 'wf_upload', 'ws-1', 'user-1', 'chat-1')

    expect(ctx?.path).toBe('uploads/photo.jpg')
  })

  it('returns null without a chat when the workspace lookup misses', async () => {
    getWorkspaceFile.mockResolvedValue(null)

    const ctx = await resolveActiveResourceContext('file', 'wf_output', 'ws-1', 'user-1')

    expect(ctx).toBeNull()
    expect(resolveChatFileRecordById).not.toHaveBeenCalled()
  })
})
