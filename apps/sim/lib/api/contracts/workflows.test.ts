import { describe, expect, it } from 'vitest'
import { executeWorkflowBodySchema, workflowStateSchema } from '@/lib/api/contracts/workflows'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

describe('workflow contracts', () => {
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
