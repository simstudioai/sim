/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VERTICAL_SPACING } from '@/lib/workflows/autolayout/constants'
import { applyTargetedLayout } from '@/lib/workflows/autolayout/targeted'
import type { Edge } from '@/lib/workflows/autolayout/types'
import { getBlockMetrics } from '@/lib/workflows/autolayout/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

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

function createBlock(id: string, overrides: Partial<BlockState> = {}): BlockState {
  return {
    id,
    type: 'function',
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  }
}

function expectVerticalSeparation(upper: BlockState, lower: BlockState): void {
  const upperMetrics = getBlockMetrics(upper)
  expect(lower.position.y).toBeGreaterThanOrEqual(
    upper.position.y + upperMetrics.height + DEFAULT_VERTICAL_SPACING
  )
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

describe('applyTargetedLayout', () => {
  beforeEach(() => {
    mockGetBlock.mockImplementation((type: string) =>
      type === 'jira' ? JIRA_TEST_BLOCK_CONFIG : undefined
    )
  })

  it('shifts downstream frozen blocks when only shift sources are provided', () => {
    const blocks = {
      source: createBlock('source', {
        position: { x: 100, y: 100 },
      }),
      target: createBlock('target', {
        position: { x: 400, y: 100 },
      }),
      end: createBlock('end', {
        position: { x: 760, y: 100 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'source',
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
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: [],
      shiftSourceBlockIds: ['source'],
    })

    expect(result.source.position).toEqual({ x: 100, y: 100 })
    expect(result.target.position).toEqual({ x: 530, y: 100 })
    expect(result.end.position).toEqual({ x: 960, y: 100 })
  })

  it('places new linear blocks without moving anchors', () => {
    const blocks = {
      anchor: createBlock('anchor', {
        position: { x: 150, y: 150 },
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'anchor',
        target: 'changed',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: ['changed'],
    })

    expect(result.anchor.position).toEqual({ x: 150, y: 150 })
    expect(result.changed.position.x).toBeGreaterThan(result.anchor.position.x)
    expect(result.changed.position.y).toBe(result.anchor.position.y)
  })

  it('keeps root-level insertions closer to anchored blocks near the top of the canvas', () => {
    const blocks = {
      start: createBlock('start', {
        position: { x: 0, y: 0 },
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
      }),
      agent: createBlock('agent', {
        position: { x: 410.94, y: 2.33 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'start',
        target: 'changed',
      },
      {
        id: 'edge-2',
        source: 'changed',
        target: 'agent',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: ['changed'],
    })

    expect(result.changed.position.y).toBeLessThan(150)
  })

  it('pushes frozen blocks below downstream nodes shifted into occupied columns', () => {
    const blocks = {
      start: createBlock('start', {
        position: { x: 100, y: 100 },
      }),
      inserted: createBlock('inserted', {
        position: { x: 0, y: 0 },
      }),
      end: createBlock('end', {
        position: { x: 400, y: 100 },
      }),
      branch: createBlock('branch', {
        position: { x: 990, y: 150 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'start',
        target: 'inserted',
      },
      {
        id: 'edge-2',
        source: 'inserted',
        target: 'end',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: ['inserted'],
    })

    expect(result.end.position).toEqual({ x: 960, y: 100 })
    expectVerticalSeparation(result.end, result.branch)
  })

  it('repairs vertical overlaps during shift-only targeted layout passes', () => {
    const blocks = {
      source: createBlock('source', {
        position: { x: 100, y: 100 },
      }),
      target: createBlock('target', {
        position: { x: 400, y: 100 },
      }),
      sibling: createBlock('sibling', {
        position: { x: 560, y: 150 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'source',
        target: 'target',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: [],
      shiftSourceBlockIds: ['source'],
    })

    expect(result.target.position).toEqual({ x: 530, y: 100 })
    expectVerticalSeparation(result.target, result.sibling)
  })

  it('resolves same-column overlaps even when another column is interleaved in Y order', () => {
    const blocks = {
      source: createBlock('source', {
        position: { x: 100, y: 100 },
      }),
      target: createBlock('target', {
        position: { x: 400, y: 100 },
      }),
      blocker: createBlock('blocker', {
        position: { x: 1500, y: 140 },
      }),
      sibling: createBlock('sibling', {
        position: { x: 560, y: 160 },
      }),
    }
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'source',
        target: 'target',
      },
    ]

    const result = applyTargetedLayout(blocks, edges, {
      changedBlockIds: [],
      shiftSourceBlockIds: ['source'],
    })

    expect(result.blocker.position).toEqual({ x: 1500, y: 140 })
    expect(result.target.position).toEqual({ x: 530, y: 100 })
    expectVerticalSeparation(result.target, result.sibling)
  })

  it('keeps resized integration blocks anchored while shifting frozen blocks below them', () => {
    const blocks = {
      above: createBlock('above', {
        position: { x: 430, y: 460 },
      }),
      jira: createJiraBlock('jira', 'write', {
        position: { x: 433, y: 690 },
      }),
      below: createBlock('below', {
        position: { x: 460, y: 1120 },
      }),
    }

    const result = applyTargetedLayout(blocks, [], {
      changedBlockIds: [],
      resizedBlockIds: ['jira'],
    })

    expect(result.above.position).toEqual({ x: 430, y: 460 })
    expect(result.jira.position).toEqual({ x: 433, y: 690 })
    expect(getBlockMetrics(result.jira).height).toBeGreaterThan(100)
    expectVerticalSeparation(result.jira, result.below)
  })

  it('places new parallel children below tall anchored siblings', () => {
    const blocks = {
      parallel: createBlock('parallel', {
        type: 'parallel',
        position: { x: 200, y: 150 },
        data: { width: 600, height: 500 },
        layout: { measuredWidth: 600, measuredHeight: 500 },
      }),
      existing: createBlock('existing', {
        position: { x: 180, y: 100 },
        data: { parentId: 'parallel', extent: 'parent' },
        layout: { measuredWidth: 250, measuredHeight: 220 },
        height: 220,
      }),
      changed: createBlock('changed', {
        position: { x: 0, y: 0 },
        data: { parentId: 'parallel', extent: 'parent' },
      }),
    }

    const result = applyTargetedLayout(blocks, [], {
      changedBlockIds: ['changed'],
    })

    const existingMetrics = getBlockMetrics(result.existing)
    expect(result.parallel.position).toEqual({ x: 200, y: 150 })
    expect(result.changed.position.y).toBeGreaterThanOrEqual(
      result.existing.position.y + existingMetrics.height
    )
  })
})
