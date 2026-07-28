import { describe, expect, it } from 'vitest'
import {
  executeWorkflowBodySchema,
  updateWorkflowBodySchema,
  workflowListItemSchema,
} from '@/lib/api/contracts/workflows'

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
})
