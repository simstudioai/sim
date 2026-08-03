/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

const { mockGetBlock } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
}))

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
}))

vi.mock('@/tools/metadata', () => ({
  getToolParams: vi.fn(() => undefined),
}))

import { Serializer } from '@/serializer'

describe('Serializer private inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue({
      name: 'Private lifecycle block',
      description: 'Test block',
      category: 'blocks',
      bgColor: '#000000',
      tools: {
        access: ['private_lifecycle'],
        config: { tool: () => 'private_lifecycle' },
      },
      subBlocks: [
        { id: 'prompt', type: 'long-input' },
        { id: 'secretScope', type: 'dropdown', hideFromCopilot: true },
        {
          id: 'mountedSecretsAdvanced',
          canonicalParamId: 'mountedSecrets',
          type: 'dropdown',
          hideFromCopilot: true,
        },
      ],
      inputs: {
        prompt: { type: 'string' },
        secretScope: { type: 'string' },
        mountedSecrets: { type: 'json' },
      },
      outputs: {},
    })
  })

  it('derives executor-private input ids from block metadata', () => {
    const block = {
      id: 'block-1',
      type: 'private_lifecycle',
      name: 'Private lifecycle block',
      position: { x: 0, y: 0 },
      subBlocks: {
        prompt: { id: 'prompt', type: 'long-input', value: 'Run the task' },
        secretScope: { id: 'secretScope', type: 'dropdown', value: 'selected' },
        mountedSecretsAdvanced: {
          id: 'mountedSecretsAdvanced',
          type: 'dropdown',
          value: ['API_KEY'],
        },
      },
      outputs: {},
      enabled: true,
    } as BlockState

    const serialized = new Serializer().serializeWorkflow({ [block.id]: block }, [], {})

    expect(serialized.blocks[0].privateInputIds).toEqual([
      'secretScope',
      'mountedSecretsAdvanced',
      'mountedSecrets',
    ])
  })
})
