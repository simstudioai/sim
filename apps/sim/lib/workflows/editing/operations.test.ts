/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/types'
import { applyOperationsToWorkflowState } from './engine'

vi.mock('@/blocks/registry', () => {
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
        { id: 'tools', type: 'tool-input' },
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
    slack: {
      type: 'slack',
      name: 'Slack',
      tools: {
        access: ['slack_message', 'slack_canvas'],
        config: {
          tool: ({ operation }: { operation?: string }) =>
            operation === 'canvas' ? 'slack_canvas' : 'slack_message',
        },
      },
      subBlocks: [
        {
          id: 'operation',
          type: 'dropdown',
          options: [
            { label: 'Send Message', id: 'send' },
            { label: 'Create Canvas', id: 'canvas' },
          ],
        },
        { id: 'channel', type: 'short-input' },
        { id: 'triggerConfig', type: 'trigger-config' },
      ],
    },
    jira: {
      type: 'jira',
      name: 'Jira',
      tools: { access: ['jira_get_issue'] },
      subBlocks: [
        { id: 'credential', type: 'oauth-input' },
        {
          id: 'projectId',
          type: 'project-selector',
          canonicalParamId: 'projectId',
          mode: 'basic',
          dependsOn: ['credential'],
        },
        {
          id: 'manualProjectId',
          type: 'short-input',
          canonicalParamId: 'projectId',
          mode: 'advanced',
          dependsOn: ['credential'],
        },
        {
          id: 'issueKey',
          type: 'file-selector',
          canonicalParamId: 'issueKey',
          mode: 'basic',
          dependsOn: ['projectId'],
        },
        {
          id: 'manualIssueKey',
          type: 'short-input',
          canonicalParamId: 'issueKey',
          mode: 'advanced',
          dependsOn: ['projectId'],
        },
        {
          id: 'transitionId',
          type: 'short-input',
          dependsOn: ['issueKey'],
        },
      ],
    },
  }

  return {
    getAllBlocks: () => Object.values(blocks),
    getBlock: (type: string) => blocks[type],
  }
})

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: () => true,
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

function makeDependentWorkflow() {
  return {
    blocks: {
      'jira-1': {
        id: 'jira-1',
        type: 'jira',
        name: 'Jira 1',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'credential-old' },
          projectId: { id: 'projectId', type: 'project-selector', value: 'PROJECT-OLD' },
          manualProjectId: {
            id: 'manualProjectId',
            type: 'short-input',
            value: '',
          },
          issueKey: { id: 'issueKey', type: 'file-selector', value: 'OLD-123' },
          manualIssueKey: { id: 'manualIssueKey', type: 'short-input', value: '' },
          transitionId: { id: 'transitionId', type: 'short-input', value: 'transition-old' },
        },
        outputs: {},
        data: {
          canonicalModes: {
            projectId: 'basic',
            issueKey: 'basic',
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

describe('handleEditOperation dependent inputs', () => {
  it('clears omitted descendants transitively when a parent changes', () => {
    const { state } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      {
        operation_type: 'edit',
        block_id: 'jira-1',
        params: { inputs: { projectId: 'PROJECT-NEW' } },
      },
    ])

    expect(state.blocks['jira-1'].subBlocks.projectId.value).toBe('PROJECT-NEW')
    expect(state.blocks['jira-1'].subBlocks.issueKey.value).toBe('')
    expect(state.blocks['jira-1'].subBlocks.transitionId.value).toBe('')
  })

  it('preserves explicitly supplied descendants and clears only their omitted descendants', () => {
    const { state } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      {
        operation_type: 'edit',
        block_id: 'jira-1',
        params: {
          inputs: {
            projectId: 'PROJECT-NEW',
            issueKey: 'NEW-456',
          },
        },
      },
    ])

    expect(state.blocks['jira-1'].subBlocks.projectId.value).toBe('PROJECT-NEW')
    expect(state.blocks['jira-1'].subBlocks.issueKey.value).toBe('NEW-456')
    expect(state.blocks['jira-1'].subBlocks.transitionId.value).toBe('')
  })

  it('does not clear descendants when the submitted parent is unchanged', () => {
    const { state } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      {
        operation_type: 'edit',
        block_id: 'jira-1',
        params: { inputs: { projectId: 'PROJECT-OLD' } },
      },
    ])

    expect(state.blocks['jira-1'].subBlocks.issueKey.value).toBe('OLD-123')
    expect(state.blocks['jira-1'].subBlocks.transitionId.value).toBe('transition-old')
  })

  it('uses canonical advanced inputs as dependency changes', () => {
    const { state } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      {
        operation_type: 'edit',
        block_id: 'jira-1',
        params: { inputs: { manualProjectId: 'PROJECT-MANUAL' } },
      },
    ])

    expect(state.blocks['jira-1'].subBlocks.manualProjectId.value).toBe('PROJECT-MANUAL')
    expect(state.blocks['jira-1'].data.canonicalModes.projectId).toBe('advanced')
    expect(state.blocks['jira-1'].subBlocks.issueKey.value).toBe('')
    expect(state.blocks['jira-1'].subBlocks.transitionId.value).toBe('')
  })

  it('clears active manual descendants when their authoring context changes', () => {
    const workflow = makeDependentWorkflow()
    const jira = workflow.blocks['jira-1']
    jira.subBlocks.projectId.value = ''
    jira.subBlocks.manualProjectId.value = 'PROJECT-MANUAL-OLD'
    jira.subBlocks.issueKey.value = ''
    jira.subBlocks.manualIssueKey.value = 'OLD-123'
    jira.data.canonicalModes.projectId = 'advanced'
    jira.data.canonicalModes.issueKey = 'advanced'

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'jira-1',
        params: { inputs: { credential: 'credential-new' } },
      },
    ])

    expect(state.blocks['jira-1'].subBlocks.manualProjectId.value).toBe('')
    expect(state.blocks['jira-1'].subBlocks.manualIssueKey.value).toBe('')
    expect(state.blocks['jira-1'].subBlocks.transitionId.value).toBe('')
  })

  it('replaces nested agent tool params instead of retaining omitted dependents', () => {
    const workflow = {
      blocks: {
        'agent-1': {
          id: 'agent-1',
          type: 'agent',
          name: 'Agent 1',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: [
                {
                  type: 'jira',
                  params: { projectId: 'PROJECT-OLD', issueKey: 'OLD-123' },
                },
              ],
            },
          },
          outputs: {},
          data: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'agent-1',
        params: {
          inputs: {
            tools: [{ type: 'jira', params: { projectId: 'PROJECT-NEW' } }],
          },
        },
      },
    ])

    expect(state.blocks['agent-1'].subBlocks.tools.value[0].params).toEqual({
      projectId: 'PROJECT-NEW',
    })
  })
})

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

/**
 * A caller that names a new block `triage` gets a UUID instead, because the
 * graph holds one id shape. Without the mapping coming back out, it cannot
 * reference what it just created except by re-reading the graph and matching on
 * name — which is why `POST /workflows/{workflowId}/operations` publishes it.
 */
describe('minted block ids', () => {
  it('reports the id a non-UUID block_id was replaced with', () => {
    const { state, mintedBlockIds } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      { operation_type: 'add', block_id: 'triage', params: { type: 'agent', name: 'Triage' } },
    ])

    expect(Object.keys(mintedBlockIds)).toEqual(['triage'])
    const mintedId = mintedBlockIds.triage
    expect(mintedId).not.toBe('triage')
    expect(state.blocks[mintedId]).toBeDefined()
    expect(state.blocks.triage).toBeUndefined()
  })

  it('reports nothing for a block_id that is already a UUID', () => {
    const uuid = 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77'
    const { state, mintedBlockIds } = applyOperationsToWorkflowState(makeDependentWorkflow(), [
      { operation_type: 'add', block_id: uuid, params: { type: 'agent', name: 'Kept' } },
    ])

    expect(mintedBlockIds).toEqual({})
    expect(state.blocks[uuid]).toBeDefined()
  })
})

describe('permission-group tool access', () => {
  const denyCanvas = { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_canvas'] }

  function emptyWorkflow() {
    return { blocks: {}, edges: [], loops: {}, parallels: {} }
  }

  it('drops an operation whose tool the group denies, keeping the block', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: '11111111-1111-4111-8111-111111111111',
          params: {
            type: 'slack',
            name: 'Slack 1',
            inputs: { operation: 'canvas', channel: '#general' },
          },
        },
      ],
      denyCanvas
    )

    const block = state.blocks['11111111-1111-4111-8111-111111111111']
    expect(block).toBeDefined()
    expect(block.subBlocks.operation.value).toBeNull()
    expect(block.subBlocks.channel.value).toBe('#general')
    expect(skippedItems).toContainEqual(
      expect.objectContaining({
        type: 'tool_not_allowed',
        operationType: 'add',
        details: { blockType: 'slack', operation: 'canvas' },
      })
    )
  })

  it('keeps an operation the group allows', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: '22222222-2222-4222-8222-222222222222',
          params: { type: 'slack', name: 'Slack 1', inputs: { operation: 'send' } },
        },
      ],
      denyCanvas
    )

    expect(state.blocks['22222222-2222-4222-8222-222222222222'].subBlocks.operation.value).toBe(
      'send'
    )
    expect(skippedItems).toEqual([])
  })

  it('leaves an existing operation untouched when an edit names a denied one', () => {
    const blockId = '33333333-3333-4333-8333-333333333333'
    const workflow = {
      blocks: {
        [blockId]: {
          id: blockId,
          type: 'slack',
          name: 'Slack 1',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: { operation: { id: 'operation', type: 'dropdown', value: 'send' } },
          outputs: {},
          data: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state, skippedItems } = applyOperationsToWorkflowState(
      workflow,
      [
        {
          operation_type: 'edit',
          block_id: blockId,
          params: { inputs: { operation: 'canvas' } },
        },
      ],
      denyCanvas
    )

    expect(state.blocks[blockId].subBlocks.operation.value).toBe('send')
    expect(skippedItems).toContainEqual(
      expect.objectContaining({ type: 'tool_not_allowed', operationType: 'edit' })
    )
  })

  it('applies no operation gate when the group denies nothing', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: '44444444-4444-4444-8444-444444444444',
          params: { type: 'slack', name: 'Slack 1', inputs: { operation: 'canvas' } },
        },
      ],
      DEFAULT_PERMISSION_GROUP_CONFIG
    )

    expect(state.blocks['44444444-4444-4444-8444-444444444444'].subBlocks.operation.value).toBe(
      'canvas'
    )
    expect(skippedItems).toEqual([])
  })

  it('drops a model the group denies, keeping the block', () => {
    const blockId = '66666666-6666-4666-8666-666666666666'
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: blockId,
          params: {
            type: 'agent',
            name: 'Agent 1',
            inputs: { model: 'gpt-4o', systemPrompt: 'You are helpful' },
          },
        },
      ],
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedModels: ['GPT-4o'] }
    )

    expect(state.blocks[blockId].subBlocks.model.value).toBeNull()
    expect(state.blocks[blockId].subBlocks.systemPrompt.value).toBe('You are helpful')
    expect(skippedItems).toContainEqual(
      expect.objectContaining({
        type: 'model_not_allowed',
        details: { blockType: 'agent', model: 'gpt-4o' },
      })
    )
  })

  it('leaves an existing model untouched when an edit names a denied one', () => {
    const blockId = '77777777-7777-4777-8777-777777777777'
    const workflow = {
      blocks: {
        [blockId]: {
          id: blockId,
          type: 'agent',
          name: 'Agent 1',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: { model: { id: 'model', type: 'combobox', value: 'claude-sonnet-4-5' } },
          outputs: {},
          data: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state } = applyOperationsToWorkflowState(
      workflow,
      [{ operation_type: 'edit', block_id: blockId, params: { inputs: { model: 'gpt-4o' } } }],
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedModels: ['gpt-4o'] }
    )

    expect(state.blocks[blockId].subBlocks.model.value).toBe('claude-sonnet-4-5')
  })

  it('keeps a model the group allows', () => {
    const blockId = '88888888-8888-4888-8888-888888888888'
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: blockId,
          params: { type: 'agent', name: 'Agent 1', inputs: { model: 'gpt-4o' } },
        },
      ],
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedModels: ['some-other-model'] }
    )

    expect(state.blocks[blockId].subBlocks.model.value).toBe('gpt-4o')
    expect(skippedItems).toEqual([])
  })

  it('gates the trigger-config fan-out, which no input validation covers', () => {
    const blockId = '99999999-9999-4999-8999-999999999999'
    const workflow = {
      blocks: {
        [blockId]: {
          id: blockId,
          type: 'slack',
          name: 'Slack 1',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'send' },
            channel: { id: 'channel', type: 'short-input', value: '#general' },
            /* The persisted aggregate, from before the tool was denied. The
               fan-out redistributes THIS onto sibling subBlocks; `inputs`
               cannot supply it, because `triggerConfig` is a runtime id the
               validated write path rejects outright. */
            triggerConfig: {
              id: 'triggerConfig',
              type: 'trigger-config',
              value: { operation: 'canvas', channel: '#random' },
            },
          },
          outputs: {},
          data: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state, skippedItems } = applyOperationsToWorkflowState(
      workflow,
      [
        {
          operation_type: 'edit',
          block_id: blockId,
          params: { inputs: { triggerConfig: {} } },
        },
      ],
      denyCanvas
    )

    const block = state.blocks[blockId]
    expect(block.subBlocks.operation.value).toBe('send')
    expect(block.subBlocks.channel.value).toBe('#random')
    expect(skippedItems).toContainEqual(
      expect.objectContaining({ type: 'tool_not_allowed', operationType: 'edit' })
    )
  })

  it('drops an agent tool entry whose operation the group denies', () => {
    const blockId = '55555555-5555-4555-8555-555555555555'
    const { state, skippedItems } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: blockId,
          params: {
            type: 'agent',
            name: 'Agent 1',
            inputs: {
              tools: [
                { type: 'slack', operation: 'canvas', title: 'Create Canvas' },
                { type: 'slack', operation: 'send', title: 'Send Message' },
              ],
            },
          },
        },
      ],
      denyCanvas
    )

    const tools = state.blocks[blockId].subBlocks.tools.value
    expect(tools.map((tool: { operation: string }) => tool.operation)).toEqual(['send'])
    expect(skippedItems).toContainEqual(
      expect.objectContaining({
        type: 'tool_not_allowed',
        details: { toolType: 'slack', operation: 'canvas' },
      })
    )
  })
})
