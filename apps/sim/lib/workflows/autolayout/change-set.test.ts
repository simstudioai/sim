/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTargetedLayoutChangeSet,
  getTargetedLayoutImpact,
} from '@/lib/workflows/autolayout/change-set'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const { mockGetBlock } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
}))

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
}))

const JIRA_TEST_BLOCK_CONFIG = {
  category: 'tools',
  subBlocks: [
    { id: 'operation', type: 'dropdown' },
    { id: 'domain', type: 'short-input' },
    { id: 'credential', type: 'oauth-input', mode: 'basic' },
    { id: 'issueKey', type: 'short-input', condition: { field: 'operation', value: 'read' } },
    { id: 'projectId', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'summary', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'description', type: 'long-input', condition: { field: 'operation', value: 'write' } },
    { id: 'priority', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'labels', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'issueType', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'parentIssue', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'assignee', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'reporter', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'environment', type: 'long-input', condition: { field: 'operation', value: 'write' } },
    { id: 'components', type: 'short-input', condition: { field: 'operation', value: 'write' } },
    { id: 'fixVersions', type: 'short-input', condition: { field: 'operation', value: 'write' } },
  ],
} as const

function createBlock(
  id: string,
  overrides: Partial<BlockState> = {},
  parentId?: string
): BlockState {
  return {
    id,
    type: 'agent',
    name: id,
    position: { x: 100, y: 100 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...(parentId ? { data: { parentId, extent: 'parent' as const } } : {}),
    ...overrides,
  }
}

function createWorkflowState({
  blocks,
  edges = [],
}: {
  blocks: Record<string, BlockState>
  edges?: WorkflowState['edges']
}): Pick<WorkflowState, 'blocks' | 'edges'> {
  return {
    blocks,
    edges,
  }
}

function createJiraBlock(
  id: string,
  operation: 'read' | 'write',
  overrides: Partial<BlockState> = {}
): BlockState {
  return createBlock(id, {
    type: 'jira',
    position: { x: 100, y: 100 },
    height: 100,
    layout: { measuredWidth: 250, measuredHeight: 100 },
    subBlocks: {
      operation: {
        id: 'operation',
        type: 'dropdown',
        value: operation,
      },
      domain: {
        id: 'domain',
        type: 'short-input',
        value: 'company.atlassian.net',
      },
      credential: {
        id: 'credential',
        type: 'oauth-input',
        value: 'credential-1',
      },
    },
    ...overrides,
  })
}

describe('getTargetedLayoutChangeSet', () => {
  beforeEach(() => {
    mockGetBlock.mockImplementation((type: string) =>
      type === 'jira' ? JIRA_TEST_BLOCK_CONFIG : undefined
    )
  })

  it('does not relayout newly added blocks that already have valid positions', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        agent: createBlock('agent', { position: { x: 400, y: 100 } }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })

  it('includes newly added blocks when they still have sentinel positions', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        agent: createBlock('agent', { position: { x: 0, y: 0 } }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual(['agent'])
  })

  it('keeps subblock-only edits anchored', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start', {
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'old value',
            },
          },
        }),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start', {
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'updated',
            },
          },
        }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })

  it('reopens edited blocks when an operation change increases their visible height', () => {
    const before = createWorkflowState({
      blocks: {
        jira: createJiraBlock('jira', 'read'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        jira: createJiraBlock('jira', 'write'),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: [],
      resizedBlockIds: ['jira'],
      shiftSourceBlockIds: [],
    })
  })

  it('does not relayout a pre-existing block legitimately placed at the origin', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start', {
          position: { x: 0, y: 0 },
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'old value',
            },
          },
        }),
      },
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start', {
          position: { x: 0, y: 0 },
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'updated',
            },
          },
        }),
      },
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })

  it('reopens only the downstream path when an edge is added later', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        function1: createBlock('function1', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'function1',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        function1: createBlock('function1', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'function1',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-2',
          source: 'start',
          target: 'function1',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: ['function1'],
      resizedBlockIds: [],
      shiftSourceBlockIds: [],
    })
  })

  it('returns a pure shift source when a stable block gains an edge to an already-connected target', () => {
    const before = createWorkflowState({
      blocks: {
        source: createBlock('source', { position: { x: 100, y: 100 } }),
        upstream: createBlock('upstream', { position: { x: 100, y: 300 } }),
        target: createBlock('target', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'upstream',
          target: 'target',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-2',
          source: 'target',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        source: createBlock('source', { position: { x: 100, y: 100 } }),
        upstream: createBlock('upstream', { position: { x: 100, y: 300 } }),
        target: createBlock('target', { position: { x: 400, y: 100 } }),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'upstream',
          target: 'target',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-2',
          source: 'target',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-3',
          source: 'source',
          target: 'target',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: [],
      resizedBlockIds: [],
      shiftSourceBlockIds: ['source'],
    })
  })

  it('distinguishes added edges when ids and handles contain hyphens', () => {
    const before = createWorkflowState({
      blocks: {
        a: createBlock('a', { position: { x: 100, y: 100 } }),
        'a-b': createBlock('a-b', { position: { x: 100, y: 300 } }),
        target: createBlock('target', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'a',
          sourceHandle: 'b-c',
          target: 'target',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        a: createBlock('a', { position: { x: 100, y: 100 } }),
        'a-b': createBlock('a-b', { position: { x: 100, y: 300 } }),
        target: createBlock('target', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'a',
          sourceHandle: 'b-c',
          target: 'target',
          targetHandle: 'target',
        },
        {
          id: 'edge-2',
          source: 'a-b',
          sourceHandle: 'c',
          target: 'target',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: [],
      resizedBlockIds: [],
      shiftSourceBlockIds: ['a-b'],
    })
  })

  it('keeps the upstream source anchored when inserting between existing blocks', () => {
    const before = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
        inserted: createBlock('inserted', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'start',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    const after = createWorkflowState({
      blocks: {
        start: createBlock('start'),
        end: createBlock('end', { position: { x: 700, y: 100 } }),
        inserted: createBlock('inserted', { position: { x: 400, y: 100 } }),
      },
      edges: [
        {
          id: 'edge-2',
          source: 'start',
          target: 'inserted',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-3',
          source: 'inserted',
          target: 'end',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutImpact({ before, after })).toEqual({
      layoutBlockIds: ['inserted'],
      resizedBlockIds: [],
      shiftSourceBlockIds: ['inserted'],
    })
  })

  it('ignores edge changes that cross layout scopes', () => {
    const before = createWorkflowState({
      blocks: {
        loop: createBlock('loop'),
        child: createBlock('child', { position: { x: 120, y: 160 } }, 'loop'),
      },
    })

    const after = createWorkflowState({
      blocks: {
        loop: createBlock('loop'),
        child: createBlock('child', { position: { x: 120, y: 160 } }, 'loop'),
      },
      edges: [
        {
          id: 'edge-1',
          source: 'loop',
          target: 'child',
          sourceHandle: 'loop-start-source',
          targetHandle: 'target',
        },
      ],
    })

    expect(getTargetedLayoutChangeSet({ before, after })).toEqual([])
  })
})
