/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { applyOperationsToWorkflowState } from './engine'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: () => [
    {
      type: 'condition',
      name: 'Condition',
      subBlocks: [{ id: 'conditions', type: 'condition-input' }],
    },
    {
      type: 'agent',
      name: 'Agent',
      subBlocks: [
        { id: 'systemPrompt', type: 'long-input' },
        { id: 'model', type: 'combobox' },
      ],
    },
    {
      type: 'function',
      name: 'Function',
      subBlocks: [
        { id: 'code', type: 'code' },
        { id: 'language', type: 'dropdown' },
      ],
    },
  ],
  getBlock: (type: string) => {
    const blocks: Record<string, any> = {
      condition: {
        type: 'condition',
        name: 'Condition',
        subBlocks: [{ id: 'conditions', type: 'condition-input' }],
      },
      agent: {
        type: 'agent',
        name: 'Agent',
        subBlocks: [
          { id: 'systemPrompt', type: 'long-input' },
          { id: 'model', type: 'combobox' },
        ],
      },
      function: {
        type: 'function',
        name: 'Function',
        subBlocks: [
          { id: 'code', type: 'code' },
          { id: 'language', type: 'dropdown' },
        ],
      },
    }
    return blocks[type] || undefined
  },
}))

function makeLoopWorkflow() {
  return {
    blocks: {
      'loop-1': {
        id: 'loop-1',
        type: 'loop',
        name: 'Loop 1',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
        data: { loopType: 'for', count: 5 },
      },
      'condition-1': {
        id: 'condition-1',
        type: 'condition',
        name: 'Condition 1',
        position: { x: 100, y: 100 },
        enabled: true,
        subBlocks: {
          conditions: {
            id: 'conditions',
            type: 'condition-input',
            value: JSON.stringify([
              { id: 'condition-1-if', title: 'if', value: 'true' },
              { id: 'condition-1-else', title: 'else', value: '' },
            ]),
          },
        },
        outputs: {},
        data: { parentId: 'loop-1', extent: 'parent' },
      },
      'agent-1': {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 300, y: 100 },
        enabled: true,
        subBlocks: {
          systemPrompt: { id: 'systemPrompt', type: 'long-input', value: 'You are helpful' },
          model: { id: 'model', type: 'combobox', value: 'gpt-4o' },
        },
        outputs: {},
        data: { parentId: 'loop-1', extent: 'parent' },
      },
    },
    edges: [
      {
        id: 'edge-1',
        source: 'loop-1',
        sourceHandle: 'loop-start-source',
        target: 'condition-1',
        targetHandle: 'target',
        type: 'default',
      },
      {
        id: 'edge-2',
        source: 'condition-1',
        sourceHandle: 'condition-condition-1-if',
        target: 'agent-1',
        targetHandle: 'target',
        type: 'default',
      },
    ],
    loops: {},
    parallels: {},
  }
}

describe('handleEditOperation nestedNodes merge', () => {
  it('preserves existing child block IDs when editing a loop with nestedNodes', () => {
    const workflow = makeLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            'new-condition': {
              type: 'condition',
              name: 'Condition 1',
              inputs: {
                conditions: [
                  { id: 'x', title: 'if', value: 'x > 1' },
                  { id: 'y', title: 'else', value: '' },
                ],
              },
            },
            'new-agent': {
              type: 'agent',
              name: 'Agent 1',
              inputs: { systemPrompt: 'Updated prompt' },
            },
          },
        },
      },
    ])

    expect(state.blocks['condition-1']).toBeDefined()
    expect(state.blocks['agent-1']).toBeDefined()
    expect(state.blocks['new-condition']).toBeUndefined()
    expect(state.blocks['new-agent']).toBeUndefined()
  })

  it('preserves edges for matched children when connections are not provided', () => {
    const workflow = makeLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            x: { type: 'condition', name: 'Condition 1' },
            y: { type: 'agent', name: 'Agent 1' },
          },
        },
      },
    ])

    const conditionEdge = state.edges.find((e: any) => e.source === 'condition-1')
    expect(conditionEdge).toBeDefined()
  })

  it('removes children not present in incoming nestedNodes', () => {
    const workflow = makeLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            x: { type: 'condition', name: 'Condition 1' },
          },
        },
      },
    ])

    expect(state.blocks['condition-1']).toBeDefined()
    expect(state.blocks['agent-1']).toBeUndefined()
    const agentEdges = state.edges.filter(
      (e: any) => e.source === 'agent-1' || e.target === 'agent-1'
    )
    expect(agentEdges).toHaveLength(0)
  })

  it('creates new children that do not match existing ones', () => {
    const workflow = makeLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            x: { type: 'condition', name: 'Condition 1' },
            y: { type: 'agent', name: 'Agent 1' },
            'new-func': { type: 'function', name: 'Function 1', inputs: { code: 'return 1' } },
          },
        },
      },
    ])

    expect(state.blocks['condition-1']).toBeDefined()
    expect(state.blocks['agent-1']).toBeDefined()
    const funcBlock = Object.values(state.blocks).find((b: any) => b.name === 'Function 1')
    expect(funcBlock).toBeDefined()
    expect((funcBlock as any).data?.parentId).toBe('loop-1')
  })

  it('updates inputs on matched children without changing their ID', () => {
    const workflow = makeLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            x: {
              type: 'agent',
              name: 'Agent 1',
              inputs: { systemPrompt: 'New prompt' },
            },
            y: { type: 'condition', name: 'Condition 1' },
          },
        },
      },
    ])

    const agent = state.blocks['agent-1']
    expect(agent).toBeDefined()
    expect(agent.subBlocks.systemPrompt.value).toBe('New prompt')
  })
})
