/**
 * @vitest-environment jsdom
 *
 * Control Bar Change Detection Tests
 *
 * This file tests the core change detection logic in the ControlBar component,
 * specifically focusing on the normalizeBlocksForComparison function and
 * semantic comparison of workflow states.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockWorkflowStore = {
  getState: vi.fn(),
  subscribe: vi.fn(),
}

const mockSubBlockStore = {
  getState: vi.fn(),
  subscribe: vi.fn(),
}

const mockWorkflowRegistry = {
  getState: vi.fn(),
  subscribe: vi.fn(),
}

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockWorkflowStore.getState())
    }
    return mockWorkflowStore
  }),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockSubBlockStore.getState())
    }
    return mockSubBlockStore
  }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: vi.fn(() => mockWorkflowRegistry.getState()),
}))

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: vi.fn((blocks) => blocks),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

const normalizeBlocksForComparison = (blocks: Record<string, any>) => {
  if (!blocks) return []

  return Object.values(blocks)
    .map((block: any) => ({
      type: block.type,
      name: block.name,
      subBlocks: block.subBlocks || {},
    }))
    .sort((a, b) => {
      // Sort by type first, then by name for consistent comparison
      const typeA = a.type || ''
      const typeB = b.type || ''
      if (typeA !== typeB) return typeA.localeCompare(typeB)
      return (a.name || '').localeCompare(b.name || '')
    })
}

describe('normalizeBlocksForComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should extract only functional properties from blocks', () => {
    const blocks = {
      'block-1': {
        id: 'block-1',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 100, y: 200 },
        height: 668,
        enabled: true,
        subBlocks: {
          systemPrompt: { id: 'systemPrompt', type: 'text', value: 'You are helpful' },
        },
      },
      'block-2': {
        id: 'block-2',
        type: 'api',
        name: 'API 1',
        position: { x: 300, y: 400 },
        height: 400,
        enabled: true,
        subBlocks: {
          url: { id: 'url', type: 'short-input', value: 'https://api.example.com' },
        },
      },
    }

    const result = normalizeBlocksForComparison(blocks)

    expect(result).toHaveLength(2)

    result.forEach((block) => {
      expect(block).toHaveProperty('type')
      expect(block).toHaveProperty('name')
      expect(block).toHaveProperty('subBlocks')

      expect(block).not.toHaveProperty('id')
      expect(block).not.toHaveProperty('position')
      expect(block).not.toHaveProperty('height')
      expect(block).not.toHaveProperty('enabled')
    })
  })

  it('should sort blocks consistently by type then name', () => {
    const blocks = {
      'block-1': { type: 'api', name: 'API 2', subBlocks: {} },
      'block-2': { type: 'agent', name: 'Agent 1', subBlocks: {} },
      'block-3': { type: 'api', name: 'API 1', subBlocks: {} },
      'block-4': { type: 'agent', name: 'Agent 2', subBlocks: {} },
    }

    const result = normalizeBlocksForComparison(blocks)

    expect(result[0]).toEqual({ type: 'agent', name: 'Agent 1', subBlocks: {} })
    expect(result[1]).toEqual({ type: 'agent', name: 'Agent 2', subBlocks: {} })
    expect(result[2]).toEqual({ type: 'api', name: 'API 1', subBlocks: {} })
    expect(result[3]).toEqual({ type: 'api', name: 'API 2', subBlocks: {} })
  })

  it('should handle blocks with undefined or null properties', () => {
    const blocks = {
      'block-1': {
        type: undefined,
        name: null,
        subBlocks: {
          field1: { value: 'test' },
        },
      },
      'block-2': {
        type: 'agent',
        name: 'Agent 1',
      },
    }

    const result = normalizeBlocksForComparison(blocks)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      type: undefined,
      name: null,
      subBlocks: { field1: { value: 'test' } },
    })
    expect(result[1]).toEqual({
      type: 'agent',
      name: 'Agent 1',
      subBlocks: {},
    })
  })

  it('should return empty array for null or undefined input', () => {
    expect(normalizeBlocksForComparison(null as any)).toEqual([])
    expect(normalizeBlocksForComparison(undefined as any)).toEqual([])
    expect(normalizeBlocksForComparison({})).toEqual([])
  })

  it('should preserve subBlock structure completely', () => {
    const blocks = {
      'agent-block': {
        type: 'agent',
        name: 'Test Agent',
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'textarea',
            value: 'You are a helpful assistant',
          },
          model: {
            id: 'model',
            type: 'dropdown',
            value: 'gpt-4',
          },
          temperature: {
            id: 'temperature',
            type: 'slider',
            value: 0.7,
          },
        },
      },
    }

    const result = normalizeBlocksForComparison(blocks)

    expect(result[0].subBlocks).toEqual(blocks['agent-block'].subBlocks)
  })
})

describe('Change Detection Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect no changes when blocks are functionally identical', () => {
    const currentBlocks = {
      'new-id-123': {
        id: 'new-id-123',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 100, y: 200 },
        subBlocks: { systemPrompt: { value: 'Test prompt' } },
      },
    }

    const deployedBlocks = {
      'old-id-456': {
        id: 'old-id-456',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 300, y: 400 },
        subBlocks: { systemPrompt: { value: 'Test prompt' } },
      },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    expect(JSON.stringify(normalizedCurrent)).toBe(JSON.stringify(normalizedDeployed))
  })

  it('should detect changes when block types differ', () => {
    const currentBlocks = {
      'block-1': { type: 'agent', name: 'Block 1', subBlocks: {} },
    }

    const deployedBlocks = {
      'block-1': { type: 'api', name: 'Block 1', subBlocks: {} },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    expect(JSON.stringify(normalizedCurrent)).not.toBe(JSON.stringify(normalizedDeployed))
  })

  it('should detect changes when block names differ', () => {
    const currentBlocks = {
      'block-1': { type: 'agent', name: 'Agent Updated', subBlocks: {} },
    }

    const deployedBlocks = {
      'block-1': { type: 'agent', name: 'Agent 1', subBlocks: {} },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    expect(JSON.stringify(normalizedCurrent)).not.toBe(JSON.stringify(normalizedDeployed))
  })

  it('should detect changes when subBlock values differ', () => {
    const currentBlocks = {
      'block-1': {
        type: 'agent',
        name: 'Agent 1',
        subBlocks: {
          systemPrompt: { value: 'Updated prompt' },
        },
      },
    }

    const deployedBlocks = {
      'block-1': {
        type: 'agent',
        name: 'Agent 1',
        subBlocks: {
          systemPrompt: { value: 'Original prompt' },
        },
      },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    expect(JSON.stringify(normalizedCurrent)).not.toBe(JSON.stringify(normalizedDeployed))
  })

  it('should detect changes when number of blocks differs', () => {
    const currentBlocks = {
      'block-1': { type: 'agent', name: 'Agent 1', subBlocks: {} },
      'block-2': { type: 'api', name: 'API 1', subBlocks: {} },
    }

    const deployedBlocks = {
      'block-1': { type: 'agent', name: 'Agent 1', subBlocks: {} },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    expect(normalizedCurrent).toHaveLength(2)
    expect(normalizedDeployed).toHaveLength(1)
    expect(JSON.stringify(normalizedCurrent)).not.toBe(JSON.stringify(normalizedDeployed))
  })

  it('should ignore position and metadata changes', () => {
    const currentBlocks = {
      'block-1': {
        id: 'new-id',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 500, y: 600 },
        height: 800,
        enabled: false,
        data: { someMetadata: 'changed' },
        subBlocks: { systemPrompt: { value: 'Test' } },
      },
    }

    const deployedBlocks = {
      'block-1': {
        id: 'old-id',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 100, y: 200 },
        height: 600,
        enabled: true,
        data: { someMetadata: 'original' },
        subBlocks: { systemPrompt: { value: 'Test' } },
      },
    }

    const normalizedCurrent = normalizeBlocksForComparison(currentBlocks)
    const normalizedDeployed = normalizeBlocksForComparison(deployedBlocks)

    // Should be identical since only metadata changed
    expect(JSON.stringify(normalizedCurrent)).toBe(JSON.stringify(normalizedDeployed))
  })
})
