import { describe, expect, it } from 'vitest'
import { executeWorkflowBodySchema } from '@/lib/api/contracts/workflows'

describe('workflow contracts', () => {
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
})
