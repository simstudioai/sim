import { describe, expect, it } from 'vitest'
import { hasWorkflowLintIssues, lintEditedWorkflowState } from './lint'

function baseBlock(id: string, type: string, name: string, subBlocks: Record<string, any> = {}) {
  return {
    id,
    type,
    name,
    enabled: true,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
  }
}

describe('lintEditedWorkflowState', () => {
  it('reports orphan blocks and empty condition/router ports', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        condition: baseBlock('condition', 'condition', 'Condition', {
          conditions: {
            value: JSON.stringify([
              { id: 'condition-if', title: 'if', value: 'true' },
              { id: 'condition-else', title: 'else', value: '' },
            ]),
          },
        }),
        router: baseBlock('router', 'router_v2', 'Router', {
          routes: {
            value: [
              { id: 'route-1', title: 'Route 1', value: 'support' },
              { id: 'route-2', title: 'Route 2', value: 'sales' },
            ],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
        function: baseBlock('function', 'function', 'Orphan Function'),
        note: baseBlock('note', 'note', 'Note'),
      },
      edges: [
        {
          id: 'edge-start-condition',
          source: 'start',
          sourceHandle: 'source',
          target: 'condition',
          targetHandle: 'target',
        },
        {
          id: 'edge-start-router',
          source: 'start',
          sourceHandle: 'source',
          target: 'router',
          targetHandle: 'target',
        },
        {
          id: 'edge-condition-agent',
          source: 'condition',
          sourceHandle: 'if',
          target: 'agent',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.orphanBlocks).toEqual([
      { blockId: 'function', blockName: 'Orphan Function', blockType: 'function' },
    ])
    expect(lint.emptyOutgoingPorts.map((port) => `${port.blockName}.${port.label}`)).toEqual([
      'Condition.else',
      'Router.route-0',
      'Router.route-1',
    ])
    expect(lint.invalidBranchPorts).toEqual([])
    expect(hasWorkflowLintIssues(lint)).toBe(true)
  })

  it('reports invalid branch handles and missing connection targets', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        condition: baseBlock('condition', 'condition', 'Condition', {
          conditions: {
            value: [{ id: 'condition-if', title: 'if', value: 'true' }],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
      },
      edges: [
        {
          id: 'edge-start-condition',
          source: 'start',
          sourceHandle: 'source',
          target: 'condition',
          targetHandle: 'target',
        },
        {
          id: 'edge-condition-agent',
          source: 'condition',
          sourceHandle: 'else',
          target: 'agent',
          targetHandle: 'target',
        },
        {
          id: 'edge-agent-missing',
          source: 'agent',
          sourceHandle: 'source',
          target: 'missing',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint.invalidBranchPorts).toEqual([
      expect.objectContaining({
        blockId: 'condition',
        sourceHandle: 'else',
      }),
    ])
    expect(lint.invalidConnectionTargets).toEqual([
      expect.objectContaining({
        sourceBlockId: 'agent',
        targetBlockId: 'missing',
        reason: 'Connection target block does not exist',
      }),
    ])
    expect(hasWorkflowLintIssues(lint)).toBe(true)
  })

  it('returns clean result when every active block and dynamic port is connected', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        router: baseBlock('router', 'router_v2', 'Router', {
          routes: {
            value: [{ id: 'route-1', title: 'Route 1', value: 'support' }],
          },
        }),
        agent: baseBlock('agent', 'agent', 'Agent'),
      },
      edges: [
        {
          id: 'edge-start-router',
          source: 'start',
          sourceHandle: 'source',
          target: 'router',
          targetHandle: 'target',
        },
        {
          id: 'edge-router-agent',
          source: 'router',
          sourceHandle: 'route-0',
          target: 'agent',
          targetHandle: 'target',
        },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    expect(lint).toEqual({
      sources: [{ blockId: 'start', blockName: 'Start', blockType: 'starter' }],
      sinks: [{ blockId: 'agent', blockName: 'Agent', blockType: 'agent' }],
      orphanBlocks: [],
      emptyOutgoingPorts: [],
      invalidBranchPorts: [],
      invalidConnectionTargets: [],
    })
    expect(hasWorkflowLintIssues(lint)).toBe(false)
  })

  it('reports sources and sinks (triggers are sources, terminals are sinks, notes excluded)', () => {
    const workflowState = {
      blocks: {
        start: baseBlock('start', 'starter', 'Start'),
        agent: baseBlock('agent', 'agent', 'Agent'),
        end: baseBlock('end', 'function', 'End'),
        note: baseBlock('note', 'note', 'Note'),
      },
      edges: [
        { id: 'e1', source: 'start', sourceHandle: 'source', target: 'agent', targetHandle: 'target' },
        { id: 'e2', source: 'agent', sourceHandle: 'source', target: 'end', targetHandle: 'target' },
      ],
    }

    const lint = lintEditedWorkflowState(workflowState as any)

    // 'start' has no incoming edge -> a source, even though it is NOT an orphan (trigger).
    expect(lint.sources).toEqual([{ blockId: 'start', blockName: 'Start', blockType: 'starter' }])
    expect(lint.orphanBlocks).toEqual([])
    // 'end' has no outgoing edge -> a sink.
    expect(lint.sinks).toEqual([{ blockId: 'end', blockName: 'End', blockType: 'function' }])
    // 'agent' has both in and out edges -> neither source nor sink.
    expect(lint.sources.map((b) => b.blockId)).not.toContain('agent')
    expect(lint.sinks.map((b) => b.blockId)).not.toContain('agent')
    // 'note' is excluded from both even though it has no edges.
    expect(lint.sources.map((b) => b.blockId)).not.toContain('note')
    expect(lint.sinks.map((b) => b.blockId)).not.toContain('note')
  })
})
