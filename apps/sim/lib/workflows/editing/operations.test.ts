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
  slack_v2: {
    type: 'slack_v2',
    name: 'Slack',
    tools: {
      access: ['slack_v2_message', 'slack_v2_canvas'],
      config: {
        tool: ({ operation }: { operation?: string }) =>
          operation === 'canvas' ? 'slack_v2_canvas' : 'slack_v2_message',
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
    ],
  },
  api_trigger: { type: 'api_trigger', name: 'API', subBlocks: [] },
  human_in_the_loop: {
    type: 'human_in_the_loop',
    name: 'Human in the Loop',
    subBlocks: [{ id: 'notification', type: 'tool-input' }],
  },
  table: {
    type: 'table',
    name: 'Table (Legacy)',
    sunset: { status: 'legacy', replacedBy: 'table_v2' },
    subBlocks: [{ id: 'tableId', type: 'short-input' }],
  },
  table_v2: {
    type: 'table_v2',
    name: 'Table',
    subBlocks: [{ id: 'tableId', type: 'short-input' }],
  },
}
const mockGetAllBlocks = getAllBlocks as Mock
const mockGetBlock = getBlock as Mock
mockGetAllBlocks.mockImplementation(() => Object.values(MOCK_REGISTRY_BLOCKS))
mockGetBlock.mockImplementation((type: string) => MOCK_REGISTRY_BLOCKS[type])

vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)

function makeLoopWorkflow(loopData: Record<string, unknown> = { loopType: 'for', count: 5 }) {
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
        data: loopData,
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

describe('a falsy loop or parallel count', () => {
  it.each([0, false, null, ''])('refuses iterations %j on an added loop', (iterations) => {
    const { state, validationErrors } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
      {
        operation_type: 'add',
        block_id: 'loop-2',
        params: { type: 'loop', name: 'Loop 2', inputs: { loopType: 'for', iterations } },
      },
    ])

    expect(validationErrors).toEqual([
      expect.objectContaining({ blockType: 'loop', field: 'iterations', value: iterations }),
    ])
    expect(Object.values(state.blocks)).toContainEqual(
      expect.objectContaining({
        name: 'Loop 2',
        data: expect.not.objectContaining({ count: expect.anything() }),
      })
    )
  })

  it('refuses count 0 on an added parallel', () => {
    const { validationErrors } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
      {
        operation_type: 'add',
        block_id: 'parallel-2',
        params: {
          type: 'parallel',
          name: 'Parallel 2',
          inputs: { parallelType: 'count', count: 0 },
        },
      },
    ])

    expect(validationErrors).toEqual([
      expect.objectContaining({ blockType: 'parallel', field: 'count', value: 0 }),
    ])
  })

  it('refuses iterations 0 on a loop merged in as an existing nested child, keeping its count', () => {
    const workflow = makeParallelWorkflow()
    const blocks: Record<string, unknown> = workflow.blocks
    blocks['inner-loop'] = {
      id: 'inner-loop',
      type: 'loop',
      name: 'Inner',
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: {},
      outputs: {},
      data: { parentId: 'loop-1', extent: 'parent', loopType: 'for', count: 4 },
    }

    const { state, validationErrors } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            inner: { type: 'loop', name: 'Inner', inputs: { loopType: 'for', iterations: 0 } },
          },
        },
      },
    ])

    expect(validationErrors).toContainEqual(
      expect.objectContaining({ blockId: 'inner-loop', field: 'iterations', value: 0 })
    )
    expect(state.blocks['inner-loop'].data.count).toBe(4)
  })
})

describe('a block rename', () => {
  it('writes a new name holding `$` replacement patterns into references literally', () => {
    const workflow = makeLoopWorkflow()
    workflow.blocks['agent-1'].subBlocks.systemPrompt.value = 'Use <condition1.result>'

    const { state } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'condition-1', params: { name: "Cond$&$'" } },
    ])

    expect(state.blocks['agent-1'].subBlocks.systemPrompt.value).toBe("Use <cond$&$'.result>")
  })

  it('rewrites references a loop holds in its collection and conditions, and in the loop record', () => {
    const workflow = makeLoopWorkflow({
      loopType: 'forEach',
      collection: '<agent1.items>',
      whileCondition: '<agent1.more> === true',
      doWhileCondition: '<agent1.more>',
    })

    const { state } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: 'agent-1', params: { name: 'Fetcher' } },
    ])

    expect(state.blocks['loop-1'].data).toMatchObject({
      collection: '<fetcher.items>',
      whileCondition: '<fetcher.more> === true',
      doWhileCondition: '<fetcher.more>',
    })
    expect(state.loops['loop-1']).toMatchObject({ forEachItems: '<fetcher.items>' })
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

describe('sunset block types', () => {
  const legacyId = '44444444-4444-4444-8444-444444444444'
  const newId = '55555555-5555-4555-8555-555555555555'
  const loopId = '66666666-6666-4666-8666-666666666666'
  const insertedId = '77777777-7777-4777-8777-777777777777'

  function tableBlock(id: string, type: string, name: string, parentId?: string) {
    return {
      id,
      type,
      name,
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: { tableId: { id: 'tableId', type: 'short-input', value: 'tbl_old' } },
      outputs: {},
      data: parentId ? { parentId } : {},
    }
  }

  it('updates a placed legacy child but refuses a new one when a container edit merges children', () => {
    const workflow = {
      blocks: {
        [loopId]: { ...tableBlock(loopId, 'loop', 'Each'), subBlocks: {} },
        [legacyId]: tableBlock(legacyId, 'table', 'Rows', loopId),
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state, skippedItems } = applyOperationsToWorkflowState(workflow, [
      {
        operation_type: 'edit',
        block_id: loopId,
        params: {
          nestedNodes: {
            [legacyId]: { type: 'table', name: 'Rows', inputs: { tableId: 'tbl_new' } },
            [newId]: { type: 'table', name: 'Fresh rows' },
          },
        },
      },
    ])

    expect(state.blocks[legacyId].subBlocks.tableId.value).toBe('tbl_new')
    expect(state.blocks[newId]).toBeUndefined()
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'block_not_allowed',
        operationType: 'add_nested_node',
        blockId: newId,
      }),
    ])
  })

  it('refuses a new legacy block, top-level or nested, and names its successor', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      { blocks: {}, edges: [], loops: {}, parallels: {} },
      [
        { operation_type: 'add', block_id: newId, params: { type: 'table', name: 'Rows' } },
        {
          operation_type: 'add',
          block_id: loopId,
          params: {
            type: 'loop',
            name: 'Each',
            nestedNodes: { [legacyId]: { type: 'table', name: 'Nested rows' } },
          },
        },
        {
          operation_type: 'insert_into_subflow',
          block_id: insertedId,
          params: { type: 'table', name: 'Inserted rows', subflowId: loopId },
        },
      ]
    )

    expect(state.blocks[newId]).toBeUndefined()
    expect(state.blocks[legacyId]).toBeUndefined()
    expect(state.blocks[insertedId]).toBeUndefined()
    expect(state.blocks[loopId]).toBeDefined()
    expect(skippedItems).toHaveLength(3)
    expect(skippedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'block_not_allowed',
          operationType: 'add',
          reason: expect.stringContaining('use "table_v2" instead'),
          details: { requestedType: 'table', replacedBy: 'table_v2' },
        }),
        expect.objectContaining({ type: 'block_not_allowed', operationType: 'add_nested_node' }),
        expect.objectContaining({
          type: 'block_not_allowed',
          operationType: 'insert_into_subflow',
        }),
      ])
    )
  })

  it('keeps an existing legacy block editable but refuses switching another block to it', () => {
    const workflow = {
      blocks: {
        [legacyId]: tableBlock(legacyId, 'table', 'Rows'),
        [newId]: tableBlock(newId, 'table_v2', 'V2'),
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const { state, skippedItems } = applyOperationsToWorkflowState(workflow, [
      { operation_type: 'edit', block_id: legacyId, params: { inputs: { tableId: 'tbl_new' } } },
      { operation_type: 'edit', block_id: newId, params: { type: 'table' } },
    ])

    expect(state.blocks[legacyId].subBlocks.tableId.value).toBe('tbl_new')
    expect(state.blocks[newId].type).toBe('table_v2')
    expect(skippedItems).toEqual([
      expect.objectContaining({ type: 'block_not_allowed', operationType: 'edit', blockId: newId }),
    ])
  })
})

describe('nestedNodes placement', () => {
  const loopId = '88888888-8888-4888-8888-888888888888'
  const agentId = '99999999-9999-4999-8999-999999999999'
  const slackId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const unknownId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const agentOnly = { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: ['agent'] }
  const children = {
    [agentId]: { type: 'agent', name: 'Inner agent' },
    [slackId]: { type: 'slack', name: 'Inner slack' },
    [unknownId]: { type: 'not_a_block', name: 'Inner unknown' },
  }

  function expectOnlyAgentPlaced(result: ReturnType<typeof applyOperationsToWorkflowState>) {
    expect(result.state.blocks[agentId]).toBeDefined()
    expect(result.state.blocks[slackId]).toBeUndefined()
    expect(result.state.blocks[unknownId]).toBeUndefined()
    expect(result.skippedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'block_not_allowed',
          operationType: 'add_nested_node',
          blockId: slackId,
        }),
        expect.objectContaining({
          type: 'invalid_block_type',
          operationType: 'add_nested_node',
          blockId: unknownId,
        }),
      ])
    )
  }

  it('holds a child of a new container to the gates of a top-level add', () => {
    const result = applyOperationsToWorkflowState(
      { blocks: {}, edges: [], loops: {}, parallels: {} },
      [
        {
          operation_type: 'add',
          block_id: loopId,
          params: { type: 'loop', name: 'Each', nestedNodes: children },
        },
      ],
      agentOnly
    )
    expectOnlyAgentPlaced(result)
  })

  it('holds a new child merged into a stored container to the gates of a top-level add', () => {
    const result = applyOperationsToWorkflowState(
      {
        blocks: {
          [loopId]: {
            id: loopId,
            type: 'loop',
            name: 'Each',
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
      },
      [{ operation_type: 'edit', block_id: loopId, params: { nestedNodes: children } }],
      agentOnly
    )
    expectOnlyAgentPlaced(result)
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

  it('drops a denied tool from a human in the loop notification, on add and on edit', () => {
    const addedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const storedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const send = { type: 'slack', operation: 'send', title: 'Notify' }
    const canvas = { type: 'slack', operation: 'canvas', title: 'Post' }
    const workflow = {
      ...emptyWorkflow(),
      blocks: {
        [storedId]: {
          id: storedId,
          type: 'human_in_the_loop',
          name: 'Stored approval',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: { notification: { id: 'notification', type: 'tool-input', value: [] } },
          outputs: {},
          data: {},
        },
      },
    }

    const { state, skippedItems } = applyOperationsToWorkflowState(
      workflow,
      [
        {
          operation_type: 'add',
          block_id: addedId,
          params: {
            type: 'human_in_the_loop',
            name: 'Approval',
            inputs: { notification: [send, canvas] },
          },
        },
        {
          operation_type: 'edit',
          block_id: storedId,
          params: { inputs: { notification: [send, canvas] } },
        },
      ],
      denyCanvas
    )

    expect(state.blocks[addedId].subBlocks.notification.value).toEqual([send])
    expect(state.blocks[storedId].subBlocks.notification.value).toEqual([send])
    expect(skippedItems.filter((item) => item.type === 'tool_not_allowed')).toEqual([
      expect.objectContaining({
        blockId: addedId,
        details: expect.objectContaining({ operation: 'canvas' }),
      }),
      expect.objectContaining({
        blockId: storedId,
        details: expect.objectContaining({ operation: 'canvas' }),
      }),
    ])
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

  it('charges an operation with several skips once, beside other declined operations', () => {
    const agentId = '66666666-6666-4666-8666-666666666666'
    const cleanId = '77777777-7777-4777-8777-777777777777'
    const { skippedItems, declinedOperationCount } = applyOperationsToWorkflowState(
      emptyWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: agentId,
          params: {
            type: 'agent',
            name: 'Agent 1',
            inputs: {
              tools: [
                { type: 'slack', operation: 'canvas', title: 'Canvas A' },
                { type: 'slack', operation: 'canvas', title: 'Canvas B' },
              ],
            },
          },
        },
        {
          operation_type: 'add',
          block_id: cleanId,
          params: { type: 'agent', name: 'Agent 2', inputs: {} },
        },
        { operation_type: 'edit', block_id: '', params: {} },
      ],
      denyCanvas
    )

    expect(skippedItems.filter((item) => item.type === 'tool_not_allowed')).toHaveLength(2)
    expect(declinedOperationCount).toBe(2)
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

  it('charges a connection refused after the handler pass to the operation that queued it', () => {
    const blockB = '88888888-8888-4888-8888-888888888888'
    const { skippedItems, declinedOperationCount } = applyOperationsToWorkflowState(
      workflowWithStart(),
      [
        {
          operation_type: 'add',
          block_id: BLOCK_A,
          params: {
            type: 'function',
            name: 'Block A',
            inputs: { code: 'return 1' },
            connections: { incoming: 'start-1', outgoing: 'start-1' },
          },
        },
        {
          operation_type: 'add',
          block_id: blockB,
          params: {
            type: 'function',
            name: 'Block B',
            inputs: { code: 'return 2' },
            connections: { success: 'start-1' },
          },
        },
      ]
    )

    expect(skippedItems.filter((item) => item.type === 'invalid_source_handle')).toHaveLength(2)
    expect(declinedOperationCount).toBe(1)
  })

  it('charges an edge dropped by the final scope check to the operation that created it', () => {
    const { state, skippedItems, declinedOperationCount } = applyOperationsToWorkflowState(
      makeLoopWorkflow(),
      [
        {
          operation_type: 'add',
          block_id: BLOCK_A,
          params: {
            type: 'function',
            name: 'Block A',
            inputs: { code: 'return 1' },
            connections: { source: 'agent-1' },
          },
        },
      ]
    )

    expect(state.edges.some((edge: { source: string }) => edge.source === BLOCK_A)).toBe(false)
    expect(skippedItems.filter((item) => item.type === 'invalid_edge_scope')).toHaveLength(1)
    expect(declinedOperationCount).toBe(1)
  })

  it('does not charge a move for the existing edges it leaves crossing scopes', () => {
    const { skippedItems, declinedOperationCount } = applyOperationsToWorkflowState(
      makeLoopWorkflow(),
      [
        {
          operation_type: 'extract_from_subflow',
          block_id: 'agent-1',
          params: { subflowId: 'loop-1' },
        },
      ]
    )

    expect(skippedItems.filter((item) => item.type === 'invalid_edge_scope')).toHaveLength(1)
    expect(declinedOperationCount).toBe(0)
  })
})

describe('moving an existing block with edit params.parentId', () => {
  function workflowWithLoop() {
    const block = (id: string, type: string, data: Record<string, unknown> = {}) => ({
      id,
      type,
      name: id,
      position: { x: 400, y: 200 },
      enabled: true,
      subBlocks: {},
      outputs: {},
      data,
    })
    return {
      blocks: {
        'loop-1': {
          ...block('loop-1', 'loop', { loopType: 'for', count: 2 }),
          position: { x: 50, y: 60 },
        },
        'fn-1': block('fn-1', 'function'),
        'fn-2': {
          ...block('fn-2', 'function', { parentId: 'loop-1', extent: 'parent' }),
          position: { x: 10, y: 20 },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }
  }

  it('moves a top-level block into a loop, keeping its id', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(workflowWithLoop(), [
      { operation_type: 'edit', block_id: 'fn-1', params: { parentId: 'loop-1' } },
    ])

    expect(skippedItems).toEqual([])
    expect(state.blocks['fn-1'].data).toMatchObject({ parentId: 'loop-1', extent: 'parent' })
    expect(state.blocks['fn-1'].position).toEqual({ x: 0, y: 0 })
  })

  it('moves a block out of its loop with a null parentId, where it sat on the canvas', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(workflowWithLoop(), [
      { operation_type: 'edit', block_id: 'fn-2', params: { parentId: null } },
    ])

    expect(skippedItems).toEqual([])
    expect(state.blocks['fn-2'].data?.parentId).toBeUndefined()
    expect(state.blocks['fn-2'].position).toEqual({ x: 60, y: 80 })
  })

  it('declines a parentId that names no loop or parallel, saying so', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(workflowWithLoop(), [
      { operation_type: 'edit', block_id: 'fn-1', params: { parentId: 'fn-2' } },
    ])

    expect(state.blocks['fn-1'].data?.parentId).toBeUndefined()
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'invalid_subflow_parent',
        operationType: 'edit',
        blockId: 'fn-1',
        reason: expect.stringContaining('not a loop or parallel container'),
      }),
    ])
  })
  it.each([
    ['itself', 'loop-1', 'loop-1'],
    ['a container nested inside it', 'loop-1', 'loop-2'],
  ])('refuses to make a container a child of %s', (_label, blockId, parentId) => {
    const workflow = workflowWithLoop()
    const nested = {
      ...workflow.blocks['loop-1'],
      id: 'loop-2',
      name: 'loop-2',
      data: { loopType: 'for', count: 2, parentId: 'loop-1', extent: 'parent' },
      position: { x: 5, y: 5 },
    }
    const { state, skippedItems } = applyOperationsToWorkflowState(
      { ...workflow, blocks: { ...workflow.blocks, 'loop-2': nested } },
      [{ operation_type: 'edit', block_id: blockId, params: { parentId } }]
    )

    expect(state.blocks['loop-1'].data?.parentId).toBeUndefined()
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'invalid_subflow_parent',
        operationType: 'edit',
        blockId,
        reason: expect.stringContaining('inside itself'),
      }),
    ])
  })

  it('refuses to insert an existing container into a container nested inside it', () => {
    const OUTER = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'
    const INNER = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d'
    const workflow = workflowWithLoop()
    const loop = workflow.blocks['loop-1']
    const blocks = {
      [OUTER]: { ...loop, id: OUTER, name: 'outer' },
      [INNER]: {
        ...loop,
        id: INNER,
        name: 'inner',
        data: { loopType: 'for', count: 2, parentId: OUTER, extent: 'parent' },
        position: { x: 5, y: 5 },
      },
    }
    const { state, skippedItems } = applyOperationsToWorkflowState({ ...workflow, blocks }, [
      {
        operation_type: 'insert_into_subflow',
        block_id: OUTER,
        params: { subflowId: INNER, type: 'loop', name: 'outer' },
      },
    ])

    expect(state.blocks[OUTER].data?.parentId).toBeUndefined()
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'invalid_subflow_parent',
        operationType: 'insert_into_subflow',
        blockId: OUTER,
        reason: expect.stringContaining('inside itself'),
      }),
    ])
  })

  it('moves a block into a loop the same batch adds, through its normalized id', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(workflowWithLoop(), [
      {
        operation_type: 'add',
        block_id: 'new-loop',
        params: { type: 'loop', name: 'New Loop', inputs: { loopType: 'for', iterations: 2 } },
      },
      { operation_type: 'edit', block_id: 'fn-1', params: { parentId: 'new-loop' } },
    ])

    expect(skippedItems).toEqual([])
    const newLoopId = Object.keys(state.blocks).find((id) => state.blocks[id].name === 'New Loop')
    expect(newLoopId).toBeDefined()
    expect(newLoopId).not.toBe('new-loop')
    expect(state.blocks['fn-1'].data?.parentId).toBe(newLoopId)
  })

  it('moves a block out of a nested loop to where it sat on the canvas', () => {
    const workflow = workflowWithLoop()
    const inner = {
      ...workflow.blocks['loop-1'],
      id: 'loop-2',
      name: 'loop-2',
      data: { loopType: 'for', count: 2, parentId: 'loop-1', extent: 'parent' },
      position: { x: 100, y: 200 },
    }
    const child = {
      ...workflow.blocks['fn-2'],
      id: 'fn-3',
      name: 'fn-3',
      data: { parentId: 'loop-2', extent: 'parent' },
      position: { x: 1, y: 2 },
    }
    const { state, skippedItems } = applyOperationsToWorkflowState(
      { ...workflow, blocks: { ...workflow.blocks, 'loop-2': inner, 'fn-3': child } },
      [{ operation_type: 'edit', block_id: 'fn-3', params: { parentId: null } }]
    )

    expect(skippedItems).toEqual([])
    expect(state.blocks['fn-3'].data?.parentId).toBeUndefined()
    expect(state.blocks['fn-3'].position).toEqual({ x: 151, y: 262 })
  })
})

describe('edge cycles', () => {
  const BLOCK_A = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a'
  const BLOCK_B = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b'

  function functionBlock(id: string, name: string) {
    return {
      id,
      type: 'function',
      name,
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
      outputs: {},
      data: {},
    }
  }

  function edge(id: string, source: string, target: string) {
    return { id, source, sourceHandle: 'source', target, targetHandle: 'target', type: 'default' }
  }

  function workflowWithStoredCycle() {
    return {
      blocks: {
        [BLOCK_A]: functionBlock(BLOCK_A, 'Block A'),
        [BLOCK_B]: functionBlock(BLOCK_B, 'Block B'),
      },
      edges: [edge('edge-ab', BLOCK_A, BLOCK_B), edge('edge-ba', BLOCK_B, BLOCK_A)],
      loops: {},
      parallels: {},
    }
  }

  const endpoints = (edges: Array<{ source: string; target: string }>) =>
    edges.map(({ source, target }) => `${source}->${target}`).sort()

  it('refuses an edge that closes a cycle as an edge_cycle skip', () => {
    const { state, skippedItems, declinedOperationCount } = applyOperationsToWorkflowState(
      { blocks: {}, edges: [], loops: {}, parallels: {} },
      [
        {
          operation_type: 'add',
          block_id: BLOCK_A,
          params: { type: 'function', name: 'Block A', connections: { source: BLOCK_B } },
        },
        {
          operation_type: 'add',
          block_id: BLOCK_B,
          params: { type: 'function', name: 'Block B', connections: { source: BLOCK_A } },
        },
      ]
    )

    expect(endpoints(state.edges)).toEqual([`${BLOCK_A}->${BLOCK_B}`])
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'edge_cycle',
        blockId: BLOCK_B,
        details: expect.objectContaining({ targetId: BLOCK_A }),
      }),
    ])
    expect(declinedOperationCount).toBe(1)
  })

  it('keeps a stored cycle through an unrelated edit and a restated connection', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(workflowWithStoredCycle(), [
      { operation_type: 'edit', block_id: BLOCK_A, params: { inputs: { code: 'return 2' } } },
      { operation_type: 'edit', block_id: BLOCK_B, params: { connections: { source: BLOCK_A } } },
    ])

    expect(skippedItems).toEqual([])
    expect(endpoints(state.edges)).toEqual([`${BLOCK_A}->${BLOCK_B}`, `${BLOCK_B}->${BLOCK_A}`])
  })

  it('accepts loop start and end handle edges around a container', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(makeLoopWorkflow(), [
      {
        operation_type: 'add',
        block_id: BLOCK_A,
        params: { type: 'function', name: 'Before Loop', connections: { source: 'loop-1' } },
      },
      {
        operation_type: 'add',
        block_id: BLOCK_B,
        params: { type: 'function', name: 'After Loop' },
      },
      {
        operation_type: 'edit',
        block_id: 'loop-1',
        params: {
          connections: { 'loop-start-source': 'condition-1', 'loop-end-source': BLOCK_B },
        },
      },
    ])

    expect(skippedItems).toEqual([])
    expect(endpoints(state.edges)).toEqual(
      [
        `${BLOCK_A}->loop-1`,
        'condition-1->agent-1',
        'loop-1->condition-1',
        `loop-1->${BLOCK_B}`,
      ].sort()
    )
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

describe('engine type placement', () => {
  const triggerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const agentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const loopId = '12121212-1212-4121-8121-121212121212'
  const insertedId = '13131313-1313-4131-8131-131313131313'
  const slackId = '14141414-1414-4141-8141-141414141414'

  function stored(id: string, type: string, name: string, subBlocks: Record<string, unknown> = {}) {
    return {
      id,
      type,
      name,
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks,
      outputs: {},
      data: {},
    }
  }

  it('refuses inserting a second trigger into a container', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      {
        blocks: {
          [triggerId]: stored(triggerId, 'api_trigger', 'API'),
          [loopId]: stored(loopId, 'loop', 'Each'),
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      [
        {
          operation_type: 'insert_into_subflow',
          block_id: insertedId,
          params: { type: 'api_trigger', name: 'API 2', subflowId: loopId },
        },
      ]
    )

    expect(state.blocks[insertedId]).toBeUndefined()
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'duplicate_trigger',
        operationType: 'insert_into_subflow',
        blockId: insertedId,
      }),
    ])
  })

  it('refuses retyping a block into a second trigger, and lets a trigger keep its own type', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      {
        blocks: {
          [triggerId]: stored(triggerId, 'api_trigger', 'API'),
          [agentId]: stored(agentId, 'agent', 'Agent'),
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      [
        { operation_type: 'edit', block_id: agentId, params: { type: 'api_trigger' } },
        { operation_type: 'edit', block_id: triggerId, params: { type: 'api_trigger' } },
      ]
    )

    expect(state.blocks[agentId].type).toBe('agent')
    expect(state.blocks[triggerId].type).toBe('api_trigger')
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'duplicate_trigger',
        operationType: 'edit',
        blockId: agentId,
      }),
    ])
  })

  it('judges the inputs of an edit that changes type against the new type', () => {
    const { state, skippedItems } = applyOperationsToWorkflowState(
      {
        blocks: {
          [slackId]: stored(slackId, 'slack_v2', 'Slack', {
            operation: { id: 'operation', type: 'dropdown', value: 'send' },
          }),
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      [
        {
          operation_type: 'edit',
          block_id: slackId,
          params: { type: 'slack', inputs: { operation: 'canvas' } },
        },
      ],
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_canvas'] }
    )

    expect(state.blocks[slackId].type).toBe('slack')
    expect(state.blocks[slackId].subBlocks.operation.value).toBe('send')
    expect(skippedItems).toEqual([
      expect.objectContaining({
        type: 'tool_not_allowed',
        operationType: 'edit',
        details: { blockType: 'slack', operation: 'canvas' },
      }),
    ])
  })
})
