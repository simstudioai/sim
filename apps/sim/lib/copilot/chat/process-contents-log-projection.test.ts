/**
 * @vitest-environment node
 *
 * Copilot's `@log` mention context, projected for the chatting user.
 *
 * `logs.cost` and `logs.trace_spans` are PROJECTIONS, not gates, and Copilot is
 * deliberately not exempt from them: it acts as the person, so a run inlined as
 * mention context must be withheld exactly as the person's own log surfaces
 * withhold it. This path resolved the run row directly with a role-only
 * authorization and inlined the run total, every span's own cost, and the whole
 * block overview — so a member withheld all three on `/api/logs/**` read them by
 * typing `@` in chat.
 *
 * Kept in its own file because it mocks `config-scope.server`, which the sibling
 * `process-contents.test.ts` deliberately leaves real so its integration-allowlist
 * tests exercise `getUserPermissionConfig`.
 */
import {
  dbChainMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '@/stores/panel'

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { processContextsServer } from '@/lib/copilot/chat/process-contents'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

function queueRun(): void {
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
            cost: { total: 0.04 },
            children: [
              { id: 'span-2', name: 'tool', type: 'tool', duration: 10, cost: { total: 0.01 } },
            ],
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
}

async function mentionSummary(userId?: string) {
  const result = await processContextsServer(
    [{ kind: 'logs', executionId: 'exec-1', label: 'My Flow' } as ChatContext],
    userId as string,
    'hello',
    'ws-1'
  )
  expect(result).toHaveLength(1)
  return JSON.parse(result[0].content)
}

describe('@log mention context projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
  })

  it('inlines spend whole for a member no group governs', async () => {
    queueRun()

    const summary = await mentionSummary('user-1')

    expect(summary.cost).toEqual({ total: 0.05 })
    expect(summary.overview[0].cost).toEqual({ total: 0.04 })
    expect(summary.overview[0].children[0].cost).toEqual({ total: 0.01 })
  })

  it('withholds the run total and every span cost when the group hides spend', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })
    queueRun()

    const summary = await mentionSummary('user-1')

    expect(summary.cost).toBeUndefined()
    expect(summary.overview).toHaveLength(1)
    expect(summary.overview[0].name).toBe('Agent 1')
    expect(summary.overview[0].cost).toBeUndefined()
    expect(summary.overview[0].children[0].cost).toBeUndefined()
  })

  /**
   * The overview is derived from `traceSpans`, which is on the withheld list the
   * log-detail path strips outright — so it is withheld entirely rather than
   * merely thinned. The run's identity, level and timings stay: these are
   * projections, not gates.
   */
  it('withholds the whole block overview when the group hides trace spans', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTraceSpans: true,
    })
    queueRun()

    const summary = await mentionSummary('user-1')

    expect(summary.overview).toBeUndefined()
    expect(summary.cost).toEqual({ total: 0.05 })
    expect(summary.executionId).toBe('exec-1')
    expect(JSON.stringify(summary)).not.toContain('Agent 1')
  })

  /** No subject, no group — never a bystander's. */
  it('resolves no group when the mention carries no subject', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
      hideTraceSpans: true,
    })
    queueRun()

    const summary = await mentionSummary(undefined)

    expect(summary.cost).toEqual({ total: 0.05 })
    expect(summary.overview).toHaveLength(1)
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
