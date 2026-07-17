/**
 * @vitest-environment node
 */

import { isRecordLike } from '@sim/utils/object'
import { describe, expect, it, vi } from 'vitest'
import { applyOperationsToWorkflowState } from './engine'

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

function findBlockIdByName(blocks: unknown, name: string): string | undefined {
  if (!isRecordLike(blocks)) return undefined

  return Object.entries(blocks).find(([, block]) => isRecordLike(block) && block.name === name)?.[0]
}

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

function makeNestedLoopWorkflow() {
  return {
    blocks: {
      'outer-loop': {
        id: 'outer-loop',
        type: 'loop',
        name: 'Outer Loop',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
        data: { loopType: 'for', count: 2 },
      },
      'inner-loop': {
        id: 'inner-loop',
        type: 'loop',
        name: 'Inner Loop',
        position: { x: 120, y: 80 },
        enabled: true,
        subBlocks: {},
        outputs: {},
        data: { parentId: 'outer-loop', extent: 'parent', loopType: 'for', count: 3 },
      },
      'inner-agent': {
        id: 'inner-agent',
        type: 'agent',
        name: 'Inner Agent',
        position: { x: 240, y: 120 },
        enabled: true,
        subBlocks: {
          systemPrompt: { id: 'systemPrompt', type: 'long-input', value: 'Original prompt' },
          model: { id: 'model', type: 'combobox', value: 'gpt-4o' },
        },
        outputs: {},
        data: { parentId: 'inner-loop', extent: 'parent' },
      },
    },
    edges: [
      {
        id: 'edge-outer-inner',
        source: 'outer-loop',
        sourceHandle: 'loop-start-source',
        target: 'inner-loop',
        targetHandle: 'target',
        type: 'default',
      },
      {
        id: 'edge-inner-agent',
        source: 'inner-loop',
        sourceHandle: 'loop-start-source',
        target: 'inner-agent',
        targetHandle: 'target',
        type: 'default',
      },
    ],
    loops: {},
    parallels: {},
  }
}

describe('handleEditOperation nestedNodes merge', () => {
  it('tracks top-level Function IDs for submitted add and edit code', () => {
    const workflow = makeLoopWorkflow()
    workflow.blocks['existing-function'] = {
      id: 'existing-function',
      type: 'function',
      name: 'Existing Function',
      position: { x: 200, y: 200 },
      enabled: true,
      subBlocks: {
        code: { id: 'code', type: 'code', value: 'return 0;' },
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
      },
      outputs: {},
      data: {},
    }

    const { state, functionCodeBlockIds } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'existing-function',
        params: { inputs: { code: 'const edited=1;return edited;' } },
      },
      {
        operation_type: 'add',
        block_id: 'added-function',
        params: {
          type: 'function',
          name: 'Added Function',
          inputs: { code: 'const added=1;return added;' },
        },
      },
    ])

    const addedFunctionId = findBlockIdByName(state.blocks, 'Added Function')
    expect(addedFunctionId).toBeDefined()
    expect(functionCodeBlockIds).toEqual(new Set([addedFunctionId, 'existing-function']))
  })

  it('tracks a Function ID when code is submitted during subflow insertion', () => {
    const { state, functionCodeBlockIds } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
      {
        operation_type: 'insert_into_subflow',
        block_id: 'inserted-function',
        params: {
          subflowId: 'loop-1',
          type: 'function',
          name: 'Inserted Function',
          inputs: { code: 'const inserted=1;return inserted;' },
        },
      },
    ])

    const insertedFunctionId = findBlockIdByName(state.blocks, 'Inserted Function')
    expect(insertedFunctionId).toBeDefined()
    expect(functionCodeBlockIds).toEqual(new Set([insertedFunctionId]))
  })

  it('tracks resolved Function block IDs with submitted code', () => {
    const workflow = makeLoopWorkflow()
    workflow.blocks['existing-function'] = {
      id: 'existing-function',
      type: 'function',
      name: 'Existing Function',
      position: { x: 200, y: 200 },
      enabled: true,
      subBlocks: {
        code: { id: 'code', type: 'code', value: 'return 0;' },
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
      },
      outputs: {},
      data: { parentId: 'loop-1', extent: 'parent' },
    }

    const { functionCodeBlockIds } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            'incoming-function': {
              type: 'function',
              name: 'Existing Function',
              inputs: { code: 'const value=1;return value;' },
            },
          },
        },
      },
    ])

    expect(functionCodeBlockIds).toEqual(new Set(['existing-function']))
  })

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

  it('persists string-serialized subblocks as JSON strings on merged children', () => {
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
          },
        },
      },
    ])

    const value = state.blocks['condition-1'].subBlocks.conditions.value
    expect(typeof value).toBe('string')
    expect(JSON.parse(value as string)[0].title).toBe('if')
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

  it('recursively updates an existing nested loop and preserves grandchild IDs', () => {
    const workflow = makeNestedLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'outer-loop',
        params: {
          nestedNodes: {
            'new-inner-loop': {
              type: 'loop',
              name: 'Inner Loop',
              inputs: {
                loopType: 'forEach',
                collection: '<start.input.items>',
              },
              nestedNodes: {
                'new-inner-agent': {
                  type: 'agent',
                  name: 'Inner Agent',
                  inputs: { systemPrompt: 'Updated prompt' },
                },
                'new-helper': {
                  type: 'function',
                  name: 'Helper',
                  inputs: { code: 'return 1' },
                },
              },
            },
          },
        },
      },
    ])

    expect(state.blocks['inner-loop']).toBeDefined()
    expect(state.blocks['new-inner-loop']).toBeUndefined()
    expect(state.blocks['inner-loop'].data.loopType).toBe('forEach')
    expect(state.blocks['inner-loop'].data.collection).toBe('<start.input.items>')

    expect(state.blocks['inner-agent']).toBeDefined()
    expect(state.blocks['new-inner-agent']).toBeUndefined()
    expect(state.blocks['inner-agent'].subBlocks.systemPrompt.value).toBe('Updated prompt')

    const helperBlock = Object.values(state.blocks).find((block: any) => block.name === 'Helper') as
      | any
      | undefined
    expect(helperBlock).toBeDefined()
    expect(helperBlock?.data?.parentId).toBe('inner-loop')
  })

  it('removes grandchildren omitted from an existing nested loop update', () => {
    const workflow = makeNestedLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'outer-loop',
        params: {
          nestedNodes: {
            'new-inner-loop': {
              type: 'loop',
              name: 'Inner Loop',
              nestedNodes: {
                'new-helper': {
                  type: 'function',
                  name: 'Helper',
                  inputs: { code: 'return 1' },
                },
              },
            },
          },
        },
      },
    ])

    expect(state.blocks['inner-loop']).toBeDefined()
    expect(state.blocks['inner-agent']).toBeUndefined()
    expect(
      state.edges.some(
        (edge: any) => edge.source === 'inner-agent' || edge.target === 'inner-agent'
      )
    ).toBe(false)

    const helperBlock = Object.values(state.blocks).find((block: any) => block.name === 'Helper')
    expect(helperBlock).toBeDefined()
  })

  it('removes an unmatched nested container with all descendants and edges', () => {
    const workflow = makeNestedLoopWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'outer-loop',
        params: {
          nestedNodes: {
            replacement: {
              type: 'function',
              name: 'Replacement',
              inputs: { code: 'return 2' },
            },
          },
        },
      },
    ])

    expect(state.blocks['inner-loop']).toBeUndefined()
    expect(state.blocks['inner-agent']).toBeUndefined()
    expect(
      state.edges.some(
        (edge: any) =>
          edge.source === 'inner-loop' ||
          edge.target === 'inner-loop' ||
          edge.source === 'inner-agent' ||
          edge.target === 'inner-agent'
      )
    ).toBe(false)

    const replacementBlock = Object.values(state.blocks).find(
      (block: any) => block.name === 'Replacement'
    ) as any
    expect(replacementBlock).toBeDefined()
    expect(replacementBlock.data?.parentId).toBe('outer-loop')
  })
})

describe('forward-reference connections (pending resolution)', () => {
  function makeMinimalWorkflow() {
    return {
      blocks: {
        'start-1': {
          id: 'start-1',
          type: 'function',
          name: 'Start',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {},
          outputs: {},
          data: {},
        },
      },
      edges: [] as any[],
      loops: {},
      parallels: {},
    }
  }

  // Valid UUIDs so block_ids are not normalized/remapped on add.
  const BLOCK_A = '11111111-1111-4111-8111-111111111111'
  const BLOCK_B = '22222222-2222-4222-8222-222222222222'

  it('defers a connection to a not-yet-created block and resolves it on a later apply', () => {
    const workflow = makeMinimalWorkflow()

    // First apply: add block A connecting to block B, which does not exist yet.
    const first = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'add',
        block_id: BLOCK_A,
        params: {
          type: 'function',
          name: 'Block A',
          inputs: { code: 'return 1' },
          connections: { source: BLOCK_B },
        },
      },
    ])

    // No edge created yet; the connection is recorded as pending on block A.
    expect(first.state.edges.some((e: any) => e.target === BLOCK_B)).toBe(false)
    expect(first.state.blocks[BLOCK_A].data.pendingConnections.source).toEqual([
      { target: BLOCK_B, targetHandle: 'target' },
    ])

    // Second apply (simulating a later edit_workflow call): add block B.
    const second = applyOperationsToWorkflowState(first.state, [
      {
        operation_type: 'add',
        block_id: BLOCK_B,
        params: { type: 'function', name: 'Block B', inputs: { code: 'return 2' } },
      },
    ])

    // The pending edge is now created and the pending record cleared.
    const edge = second.state.edges.find((e: any) => e.source === BLOCK_A && e.target === BLOCK_B)
    expect(edge).toBeDefined()
    expect(second.state.blocks[BLOCK_A].data?.pendingConnections).toBeUndefined()
  })

  it('resolves a forward-reference connection within a single apply regardless of operation order', () => {
    const workflow = makeMinimalWorkflow()

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'add',
        block_id: BLOCK_A,
        params: {
          type: 'function',
          name: 'Block A',
          inputs: { code: 'return 1' },
          connections: { source: BLOCK_B },
        },
      },
      {
        operation_type: 'add',
        block_id: BLOCK_B,
        params: { type: 'function', name: 'Block B', inputs: { code: 'return 2' } },
      },
    ])

    const edge = state.edges.find((e: any) => e.source === BLOCK_A && e.target === BLOCK_B)
    expect(edge).toBeDefined()
    expect(state.blocks[BLOCK_A].data?.pendingConnections).toBeUndefined()
  })
})
