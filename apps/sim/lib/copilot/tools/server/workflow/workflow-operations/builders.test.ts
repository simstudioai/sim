/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createBlockFromParams,
  pruneInvalidSubflowBoundaryEdgesForBlock,
  validateSubflowBoundaryEdge,
} from './builders'

const agentBlockConfig = {
  type: 'agent',
  name: 'Agent',
  outputs: {
    content: { type: 'string', description: 'Default content output' },
  },
  subBlocks: [{ id: 'responseFormat', type: 'response-format' }],
}

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: () => [agentBlockConfig],
  getBlock: (type: string) => (type === 'agent' ? agentBlockConfig : undefined),
}))

describe('createBlockFromParams', () => {
  it('derives agent outputs from responseFormat when outputs are not provided', () => {
    const block = createBlockFromParams('b-agent', {
      type: 'agent',
      name: 'Agent',
      inputs: {
        responseFormat: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Structured answer text',
            },
          },
          required: ['answer'],
        },
      },
      triggerMode: false,
    })

    expect(block.outputs.answer).toBeDefined()
    expect(block.outputs.answer.type).toBe('string')
  })
})

describe('validateSubflowBoundaryEdge', () => {
  it('rejects child-to-root crossing edges', () => {
    const state = {
      blocks: {
        child: { id: 'child', type: 'function', data: { parentId: 'loop1' } },
        root: { id: 'root', type: 'function', data: {} },
      },
    }

    const result = validateSubflowBoundaryEdge(state, 'child', 'root', 'source')
    expect(result.valid).toBe(false)
  })

  it('accepts same-parent child edges', () => {
    const state = {
      blocks: {
        childA: { id: 'childA', type: 'function', data: { parentId: 'loop1' } },
        childB: { id: 'childB', type: 'function', data: { parentId: 'loop1' } },
      },
    }

    const result = validateSubflowBoundaryEdge(state, 'childA', 'childB', 'source')
    expect(result.valid).toBe(true)
  })

  it('enforces loop start and end handle boundaries', () => {
    const state = {
      blocks: {
        loop1: { id: 'loop1', type: 'loop', data: {} },
        child: { id: 'child', type: 'function', data: { parentId: 'loop1' } },
        outside: { id: 'outside', type: 'function', data: {} },
      },
    }

    expect(validateSubflowBoundaryEdge(state, 'loop1', 'outside', 'loop-start-source').valid).toBe(
      false
    )
    expect(validateSubflowBoundaryEdge(state, 'loop1', 'child', 'loop-start-source').valid).toBe(
      true
    )
    expect(validateSubflowBoundaryEdge(state, 'loop1', 'child', 'loop-end-source').valid).toBe(
      false
    )
    expect(validateSubflowBoundaryEdge(state, 'loop1', 'outside', 'loop-end-source').valid).toBe(
      true
    )
  })
})

describe('pruneInvalidSubflowBoundaryEdgesForBlock', () => {
  it('removes stale edges that become invalid after extraction', () => {
    const state: any = {
      blocks: {
        loop1: { id: 'loop1', type: 'loop', data: {} },
        child: { id: 'child', type: 'function', data: {} },
      },
      edges: [
        {
          id: 'edge-loop-start-to-child',
          source: 'loop1',
          sourceHandle: 'loop-start-source',
          target: 'child',
          targetHandle: 'target',
        },
      ],
    }
    const skipped: any[] = []
    const logger = { info: vi.fn(), warn: vi.fn() } as any

    pruneInvalidSubflowBoundaryEdgesForBlock(
      state,
      'child',
      'extract_from_subflow',
      logger,
      skipped
    )

    expect(state.edges).toHaveLength(0)
    expect(skipped).toHaveLength(1)
    expect(skipped[0].type).toBe('invalid_subflow_boundary_edge')
  })
})
