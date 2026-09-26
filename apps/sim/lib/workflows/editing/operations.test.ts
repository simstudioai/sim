import { integrationsAvailabilityMock } from '@sim/testing/mocks/integrations-availability.mock'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { createBlockFromParams } from '@/lib/workflows/editing/builders'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { getAllBlocks, getBlock } from '@/blocks/registry'
import { applyOperationsToWorkflowState } from './engine'

const MOCK_REGISTRY_BLOCKS: Record<string, any> = {
  conditional_format: {
    type: 'conditional_format',
    name: 'Conditional Format',
    subBlocks: [
      { id: 'mode', type: 'short-input', value: () => 'compact' },
      {
        id: 'format',
        type: 'dropdown',
        condition: () => ({ field: 'mode', value: ['compact'] }),
        options: [{ id: 'json', label: 'JSON' }],
      },
      {
        id: 'format',
        type: 'dropdown',
        condition: { field: 'mode', value: 'tabular' },
        options: [{ id: 'csv', label: 'CSV' }],
      },
    ],
  },
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
  mothership: {
    type: 'mothership',
    name: 'Sim Chat',
    subBlocks: [{ id: 'tools', type: 'tool-input' }],
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
const mockGetAllBlocks = getAllBlocks as Mock
const mockGetBlock = getBlock as Mock
mockGetAllBlocks.mockImplementation(() => Object.values(MOCK_REGISTRY_BLOCKS))
mockGetBlock.mockImplementation((type: string) => MOCK_REGISTRY_BLOCKS[type])

vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)

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

  it('switches nested Agent Tool Mode based on the canonical field supplied', () => {
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
                  type: 'custom-tool',
                  customToolId: 'custom-1',
                  usageControl: 'auto',
                  usageControlExpression: '<route.oldToolMode>',
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

    const basicRoundTrip = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'agent-1',
        params: {
          inputs: {
            tools: [
              {
                type: 'custom-tool',
                customToolId: 'custom-1',
                usageControl: 'auto',
                usageControlExpression: '<route.oldToolMode>',
              },
            ],
          },
        },
      },
    ]).state

    expect(basicRoundTrip.blocks['agent-1'].data.canonicalModes).not.toHaveProperty(
      '0:agentToolUsageControl'
    )

    const advanced = applyOperationsToWorkflowState(basicRoundTrip, [
      {
        operation_type: 'edit',
        block_id: 'agent-1',
        params: {
          inputs: {
            tools: [
              {
                type: 'custom-tool',
                customToolId: 'custom-1',
                usageControlExpression: '<route.toolMode>',
              },
            ],
          },
        },
      },
    ]).state

    expect(advanced.blocks['agent-1'].data.canonicalModes).toMatchObject({
      '0:agentToolUsageControl': 'advanced',
    })

    const basic = applyOperationsToWorkflowState(advanced, [
      {
        operation_type: 'edit',
        block_id: 'agent-1',
        params: {
          inputs: {
            tools: [{ type: 'custom-tool', customToolId: 'custom-1', usageControl: 'force' }],
          },
        },
      },
    ]).state

    expect(basic.blocks['agent-1'].data.canonicalModes).not.toHaveProperty(
      '0:agentToolUsageControl'
    )
  })
})

function makeParallelWorkflow() {
  const workflow = makeLoopWorkflow()
  workflow.blocks['loop-1'].type = 'parallel'
  workflow.blocks['loop-1'].data = { parallelType: 'count', count: 5 }
  return workflow
}

describe('handleEditOperation container inputs', () => {
  it('reports an unknown loop input field instead of discarding it silently', () => {
    const workflow = makeLoopWorkflow()

    const { state, validationErrors } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'loop-1', params: { inputs: { count: 3 } } },
    ])

    expect(validationErrors).toHaveLength(1)
    expect(validationErrors[0]).toMatchObject({ blockId: 'loop-1', field: 'count' })
    expect(validationErrors[0].error).toContain('iterations')
    expect(state.blocks['loop-1'].data.count).toBe(5)
  })

  it('applies `count` on a parallel container, the key the read view exports', () => {
    const workflow = makeParallelWorkflow()

    const { state, validationErrors } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'loop-1', params: { inputs: { count: 3 } } },
    ])

    expect(validationErrors).toEqual([])
    expect(state.blocks['loop-1'].data.count).toBe(3)
  })

  it('reports `iterations` on a parallel container and names `count` instead', () => {
    const workflow = makeParallelWorkflow()

    const { state, validationErrors } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'loop-1', params: { inputs: { iterations: 3 } } },
    ])

    expect(validationErrors).toHaveLength(1)
    expect(validationErrors[0]).toMatchObject({ blockId: 'loop-1', field: 'iterations' })
    expect(validationErrors[0].error).toContain('count')
    expect(state.blocks['loop-1'].data.count).toBe(5)
  })

  it.each([
    ['a count parallel', makeParallelWorkflow, 5],
    ['a for loop', makeLoopWorkflow, 5],
  ])("round-trips the read view's container inputs for %s", (_label, makeWorkflow, expected) => {
    const workflow = makeWorkflow()
    const readInputs = sanitizeForCopilot(workflow as any).blocks['loop-1'].inputs

    const { state, validationErrors } = applyOperationsToWorkflowState(makeWorkflow(), [
      { operation_type: 'edit', block_id: 'loop-1', params: { inputs: readInputs } },
    ])

    expect(validationErrors).toEqual([])
    expect(state.blocks['loop-1'].data.count).toBe(expected)
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

describe('tool canonical-mode reindexing', () => {
  const selectorTool = {
    type: 'jira',
    operation: 'jira_get_issue',
    title: 'Selector',
    params: { projectId: 'PROJ' },
    usageControl: 'auto',
    isExpanded: false,
  }
  const variableTool = {
    type: 'jira',
    operation: 'jira_get_issue',
    title: 'Variable',
    params: { manualProjectId: '{{PROJECT}}' },
    usageControl: 'auto',
    isExpanded: false,
  }

  function agentWithTools(tools: unknown[], canonicalModes: Record<string, 'basic' | 'advanced'>) {
    return {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          subBlocks: { tools: { id: 'tools', type: 'tool-input', value: tools } },
          data: { canonicalModes },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }
  }

  function editTools(workflow: Record<string, unknown>, tools: unknown[]) {
    const { state } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'agent', params: { inputs: { tools } } },
    ])
    return state.blocks.agent.data.canonicalModes
  }

  it('moves each tool mode with it when the edit reorders the tools', () => {
    const workflow = agentWithTools([selectorTool, variableTool], {
      '0:projectId': 'basic',
      '1:projectId': 'advanced',
    })

    expect(editTools(workflow, [variableTool, selectorTool])).toEqual({
      '0:projectId': 'advanced',
      '1:projectId': 'basic',
    })
  })

  it('drops a removed tool mode so a later tool cannot inherit its position', () => {
    const workflow = agentWithTools([selectorTool, variableTool], {
      '0:projectId': 'basic',
      '1:projectId': 'advanced',
    })

    expect(editTools(workflow, [selectorTool])).toEqual({ '0:projectId': 'basic' })
    expect(editTools(workflow, [])).toEqual({})
  })

  it('selects a Permission Mode at the final position of a tool the edit also moves', () => {
    const fixedTool = { ...selectorTool, usageControl: 'force' }
    const expressionTool = {
      type: 'jira',
      operation: 'jira_get_issue',
      title: 'Variable',
      params: { manualProjectId: '{{PROJECT}}' },
      usageControlExpression: '<start.toolMode>',
      isExpanded: false,
    }
    const workflow = agentWithTools([expressionTool, fixedTool], {
      '0:agentToolUsageControl': 'advanced',
    })

    expect(editTools(workflow, [fixedTool, expressionTool])).toEqual({
      '1:agentToolUsageControl': 'advanced',
    })
  })

  it('switches Sim Chat between variable and fixed tool modes through operations apply', () => {
    const tool = {
      type: 'mcp',
      params: { serverId: 'server', toolName: 'search' },
      usageControl: 'auto',
    }
    const workflow = agentWithTools([tool], {})
    workflow.blocks.agent.type = 'mothership'
    expect(
      editTools(workflow, [
        { type: 'mcp', params: tool.params, usageControlExpression: '<start.toolMode>' },
      ])
    ).toEqual({ '0:agentToolUsageControl': 'advanced' })
    const variable = agentWithTools(
      [{ type: 'mcp', params: tool.params, usageControlExpression: '<start.toolMode>' }],
      { '0:agentToolUsageControl': 'advanced' }
    )
    variable.blocks.agent.type = 'mothership'
    expect(editTools(variable, [{ ...tool, usageControl: 'none' }])).toEqual({})
  })

  it('keeps a round-tripped Permission Mode with its tool when an explicit choice moves past it', () => {
    const roundTripTool = { ...selectorTool, usageControlExpression: '<start.dormant>' }
    const expressionTool = {
      type: 'jira',
      operation: 'jira_get_issue',
      title: 'Variable',
      params: { manualProjectId: '{{PROJECT}}' },
      usageControlExpression: '<start.toolMode>',
      isExpanded: false,
    }
    const workflow = agentWithTools([roundTripTool, expressionTool], {
      '1:agentToolUsageControl': 'advanced',
    })

    expect(editTools(workflow, [expressionTool, roundTripTool])).toEqual({
      '0:agentToolUsageControl': 'advanced',
    })
  })
})

/**
 * A `connections` value the parser does not understand used to be ignored: the
 * block landed, `applied` counted it, and nothing said the wiring never
 * happened. The handle and the accepted shapes are now named as a dropped input.
 */
describe('connection shape validation', () => {
  const BLOCK_A = '44444444-4444-4444-8444-444444444444'

  function workflowWithStart() {
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
      edges: [],
      loops: {},
      parallels: {},
    }
  }

  it('reports a connections value of an unsupported shape instead of dropping it silently', () => {
    const { state, validationErrors, skippedItems } = applyOperationsToWorkflowState(
      workflowWithStart(),
      [
        {
          operation_type: 'add',
          block_id: BLOCK_A,
          params: {
            type: 'function',
            name: 'Block A',
            inputs: { code: 'return 1' },
            connections: { source: { target: 'start-1' }, error: [{ target: 'start-1' }] },
          },
        },
      ]
    )

    expect(state.blocks[BLOCK_A]).toBeDefined()
    expect(state.edges).toEqual([])
    expect(skippedItems).toEqual([])
    expect(validationErrors).toEqual([
      {
        blockId: BLOCK_A,
        blockType: 'function',
        field: 'connections',
        value: { target: 'start-1' },
        error:
          'connections["source"]: expected a target block id, {block, handle?}, or an array of those',
      },
      {
        blockId: BLOCK_A,
        blockType: 'function',
        field: 'connections',
        value: { target: 'start-1' },
        error: 'connections["error"][0]: expected a target block id or {block, handle?}',
      },
    ])
  })

  it('wires the accepted shapes and reports a handle the block lacks as a skip', () => {
    const { state, validationErrors, skippedItems } = applyOperationsToWorkflowState(
      workflowWithStart(),
      [
        {
          operation_type: 'add',
          block_id: BLOCK_A,
          params: {
            type: 'function',
            name: 'Block A',
            inputs: { code: 'return 1' },
            connections: { success: 'start-1', error: [{ block: 'start-1' }], incoming: 'start-1' },
          },
        },
      ]
    )

    expect(validationErrors).toEqual([])
    expect(state.edges.map((edge: { sourceHandle?: string }) => edge.sourceHandle).sort()).toEqual([
      'error',
      'source',
    ])
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'invalid_source_handle',
        blockId: BLOCK_A,
        details: expect.objectContaining({ sourceHandle: 'incoming' }),
      }),
    ])
  })
})

describe('conditional input validation through workflow operations', () => {
  const blockId = 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77'

  function workflowWithStoredDefault() {
    const workflow = makeLoopWorkflow()
    const formatter: BlockState = createBlockFromParams(blockId, {
      type: 'conditional_format',
      name: 'Formatter',
    })
    expect(formatter.subBlocks.mode.value).toBe('compact')
    return { ...workflow, blocks: { ...workflow.blocks, [blockId]: formatter } }
  }

  it('validates an add against explicit selectors regardless of input order', () => {
    const { state, validationErrors } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
      {
        operation_type: 'add',
        block_id: blockId,
        params: {
          type: 'conditional_format',
          name: 'Formatter',
          inputs: { format: 'json', mode: 'compact' },
        },
      },
    ])
    expect(validationErrors).toEqual([])
    expect(state.blocks[blockId].subBlocks.format.value).toBe('json')
  })

  it.each(['edit', 'nested', 'insert'] as const)(
    'uses the stored default selector for a partial %s write',
    (path) => {
      const workflow = workflowWithStoredDefault()
      const operations: EditWorkflowOperation[] = []
      if (path === 'nested') {
        workflow.blocks[blockId].data = { parentId: 'loop-1', extent: 'parent' }
        operations.push({
          operation_type: 'edit',
          block_id: 'loop-1',
          params: {
            nestedNodes: {
              incoming: {
                type: 'conditional_format',
                name: 'Formatter',
                inputs: { format: 'json' },
              },
            },
          },
        })
      } else {
        operations.push({
          operation_type: path === 'insert' ? 'insert_into_subflow' : 'edit',
          block_id: blockId,
          params: {
            subflowId: 'loop-1',
            type: 'conditional_format',
            name: 'Formatter',
            inputs: { format: 'json' },
          },
        })
      }
      const { state, validationErrors } = applyOperationsToWorkflowState(workflow, operations)
      expect(validationErrors).toEqual([])
      expect(state.blocks[blockId].subBlocks.format.value).toBe('json')
      expect(state.blocks[blockId].subBlocks.mode.value).toBe('compact')
      expect(workflow.blocks[blockId].subBlocks.format.value).toBeNull()
    }
  )

  it('uses incoming selectors over stored values and reports invalid active choices', () => {
    const workflow = workflowWithStoredDefault()
    const { state, validationErrors } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: blockId,
        params: { inputs: { format: 'csv', mode: 'tabular' } },
      },
    ])
    expect(validationErrors).toEqual([])
    expect(state.blocks[blockId].subBlocks.format.value).toBe('csv')

    const rejected = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: blockId, params: { inputs: { format: 'csv' } } },
    ])
    expect(rejected.validationErrors.map((error) => error.field)).toEqual(['format'])
    expect(rejected.state.blocks[blockId].subBlocks.format.value).toBeNull()
    expect(workflow.blocks[blockId].subBlocks.format.value).toBeNull()
  })

  it.each([{}, { mode: 'dormant' }])(
    'preserves the existing dormant fallback on add without a matching selector: %j',
    (selectors) => {
      /**
       * Characterizes the compatibility boundary, not correct default inference:
       * add validation still runs before default seeding and does not infer mode.
       */
      const { state, validationErrors } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
        {
          operation_type: 'add',
          block_id: blockId,
          params: {
            type: 'conditional_format',
            name: 'Formatter',
            inputs: { ...selectors, format: 'csv' },
          },
        },
      ])
      expect(validationErrors).toEqual([])
      expect(state.blocks[blockId].subBlocks.format.value).toBe('csv')
    }
  )
})

describe('Mothership tool attachment writes', () => {
  const tool = { type: 'slack', operation: 'send', title: 'Approved sender' }
  const graph = { blocks: {}, edges: [], loops: {}, parallels: {} }
  const add: EditWorkflowOperation = {
    operation_type: 'add',
    block_id: 'agent',
    params: { type: 'agent', name: 'Agent', inputs: { tools: [tool] } },
  }

  it('rejects an alias before storing a new binding, without changing ordinary API authoring', () => {
    const internal = applyOperationsToWorkflowState(graph, [add], null, true)
    expect(internal.validationErrors).toEqual([
      expect.objectContaining({ field: 'tools', error: expect.stringContaining('read-only') }),
    ])
    const publicResult = applyOperationsToWorkflowState(graph, [add])
    expect(publicResult.validationErrors).toEqual([])
    const id = publicResult.mintedBlockIds.agent
    expect(publicResult.state.blocks[id].subBlocks.tools.value[0].title).toBe('Approved sender')
  })

  it('preserves existing labels during unrelated edits and rejects a subsequent rename', () => {
    const existing = applyOperationsToWorkflowState(graph, [add])
    const id = existing.mintedBlockIds.agent
    const untouched = applyOperationsToWorkflowState(
      existing.state,
      [
        {
          operation_type: 'edit',
          block_id: id,
          params: { inputs: { systemPrompt: 'New instructions' } },
        },
      ],
      null,
      true
    )
    expect(untouched.validationErrors).toEqual([])
    expect(untouched.state.blocks[id].subBlocks.tools.value[0].title).toBe('Approved sender')
    const preserved = applyOperationsToWorkflowState(
      existing.state,
      [
        {
          operation_type: 'edit',
          block_id: id,
          params: { inputs: { tools: [{ ...tool, params: { channel: 'support' } }] } },
        },
      ],
      null,
      true
    )
    expect(preserved.validationErrors).toEqual([])
    const renamed = applyOperationsToWorkflowState(
      existing.state,
      [
        {
          operation_type: 'edit',
          block_id: id,
          params: { inputs: { tools: [{ ...tool, title: 'Another name' }] } },
        },
      ],
      null,
      true
    )
    expect(renamed.validationErrors[0]?.error).toContain('read-only')
    expect(renamed.state.blocks[id].subBlocks.tools.value[0].title).toBe('Approved sender')
  })

  it('refuses an integration selection that Sim Chat would ignore', () => {
    const result = applyOperationsToWorkflowState(
      graph,
      [
        {
          ...add,
          params: {
            type: 'mothership',
            name: 'Sim Chat',
            inputs: { tools: [{ type: 'slack', operation: 'send' }] },
          },
        },
      ],
      null,
      true
    )
    expect(result.validationErrors[0]?.error).toContain('MCP tool or MCP server bindings only')
  })
})
