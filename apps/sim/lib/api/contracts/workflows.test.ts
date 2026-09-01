import { describe, expect, it } from 'vitest'
import {
  cancelWorkflowExecutionReasonSchema,
  executeWorkflowBodySchema,
  getWorkflowResponseDataSchema,
  updateWorkflowBodySchema,
  workflowListItemSchema,
  workflowStateSchema,
} from '@/lib/api/contracts/workflows'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

describe('workflow contracts', () => {
  /**
   * Agent-event frames are additive to an existing wire format, so an
   * integration that never asked for them must keep the frame set it has.
   */
  it('leaves agent-event exposure off when the caller does not ask for it', () => {
    const parsed = executeWorkflowBodySchema.parse({ stream: true })

    expect(parsed.includeThinking).toBe(false)
    expect(parsed.includeToolCalls).toBe(false)
  })

  it('accepts each agent-event policy independently', () => {
    expect(executeWorkflowBodySchema.parse({ stream: true, includeToolCalls: true })).toMatchObject(
      { includeThinking: false, includeToolCalls: true }
    )

    expect(executeWorkflowBodySchema.parse({ stream: true, includeThinking: true })).toMatchObject({
      includeThinking: true,
      includeToolCalls: false,
    })
  })

  it('accepts a trusted prior-execution input reference', () => {
    expect(
      executeWorkflowBodySchema.parse({ inputFromExecutionId: 'execution-123' })
    ).toMatchObject({ inputFromExecutionId: 'execution-123' })
  })

  it('retains a private workflow-input provenance envelope for boundary validation', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: 'input',
          provenance: {
            version: 1 as const,
            complete: true,
            entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
            scope: { userId: 'parent-owner', workspaceId: 'workspace-1' },
          },
        },
      ],
    }

    expect(
      executeWorkflowBodySchema.parse({ [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle })
    ).toMatchObject({ [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle })
  })

  it('normalizes null React Flow edge handles in execution overrides', () => {
    const parsed = executeWorkflowBodySchema.parse({
      workflowStateOverride: {
        blocks: {
          source: {
            id: 'source',
            type: 'start_trigger',
            name: 'Start',
            position: { x: 0, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
          target: {
            id: 'target',
            type: 'function',
            name: 'Function',
            position: { x: 100, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'source',
            target: 'target',
            sourceHandle: null,
            targetHandle: null,
            type: 'workflowEdge',
          },
        ],
        loops: {},
        parallels: {},
      },
    })

    expect(parsed.workflowStateOverride?.edges[0].sourceHandle).toBeUndefined()
    expect(parsed.workflowStateOverride?.edges[0].targetHandle).toBeUndefined()
  })

  it('updateWorkflowBodySchema accepts forkSyncExcluded and leaves it optional', () => {
    expect(updateWorkflowBodySchema.parse({ forkSyncExcluded: true }).forkSyncExcluded).toBe(true)
    expect(updateWorkflowBodySchema.parse({}).forkSyncExcluded).toBeUndefined()
  })

  it('workflowListItemSchema defaults an absent forkSyncExcluded to false (old-server tolerance)', () => {
    const item = workflowListItemSchema.parse({
      id: 'wf-1',
      name: 'Alpha',
      description: null,
      workspaceId: 'ws-1',
      folderId: null,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
      locked: false,
    })
    expect(item.forkSyncExcluded).toBe(false)
  })

  it('detail response preserves forkSyncExcluded and defaults old responses', () => {
    const forkPolicySchema = getWorkflowResponseDataSchema.pick({ forkSyncExcluded: true })

    expect(forkPolicySchema.parse({ forkSyncExcluded: true }).forkSyncExcluded).toBe(true)
    expect(forkPolicySchema.parse({}).forkSyncExcluded).toBe(false)
  })

  it('exposes the cancellation service vocabulary to every cancel surface', () => {
    for (const reason of [
      'already_cancelled',
      'already_completed',
      'already_failed',
      'queue_cancelled',
      'active_resume_signal_failed',
      'cancellation_not_finalized',
    ]) {
      expect(cancelWorkflowExecutionReasonSchema.options).toContain(reason)
    }
  })

  /**
   * `workflowStateSchema` is the PUT `/api/workflows/[id]/state` body and also
   * the `state` slot of the GET response. A stored value outside these bounds
   * used to 500 the read, which is now prevented by pinning the policy when the
   * normalized tables are loaded — not by widening the write contract. Relaxing
   * these bounds would let a caller persist a policy the executor will not run.
   */
  it('rejects a retry policy outside the bounds on the write contract', () => {
    const stateWith = (retry: Record<string, unknown>) => ({
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'api',
          name: 'API',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          retry,
        },
      },
      edges: [],
    })

    expect(
      workflowStateSchema.safeParse(
        stateWith({ enabled: true, maxTries: 999, waitBetweenTriesMs: 0 })
      ).success
    ).toBe(false)
    expect(
      workflowStateSchema.safeParse(
        stateWith({ enabled: true, maxTries: 3, waitBetweenTriesMs: 10_000_000 })
      ).success
    ).toBe(false)
    expect(
      workflowStateSchema.safeParse(
        stateWith({ enabled: true, maxTries: 3, waitBetweenTriesMs: 0 })
      ).success
    ).toBe(true)
  })
})
