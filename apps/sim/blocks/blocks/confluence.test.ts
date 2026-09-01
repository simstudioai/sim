/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfluenceV2Block } from '@/blocks/blocks/confluence'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getAllBlocks: vi.fn(() => []),
  getLatestBlock: vi.fn(() => undefined),
  getBlockRegistry: vi.fn(() => ({})),
  getBlockByToolName: vi.fn(() => undefined),
  getBlocksByCategory: vi.fn(() => []),
}))

import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

function legacySearchBlock(field: string, value: string, advancedMode: boolean): BlockState {
  const values = { operation: 'search_in_space', [field]: value }
  return {
    id: 'block-1',
    type: 'confluence_v2',
    name: 'Confluence 1',
    position: { x: 0, y: 0 },
    advancedMode,
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, fieldValue]) => [
        id,
        { id, type: 'short-input', value: fieldValue },
      ])
    ),
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

function mappedSearchParams(state: BlockState): {
  blocks: Record<string, BlockState>
  params: Record<string, unknown>
} {
  const { blocks } = migrateSubblockIds({ 'block-1': state })
  const params = extractBlockParams(blocks['block-1'])
  const transform = ConfluenceV2Block.tools.config?.params
  if (!transform) throw new Error('Confluence V2 block has no params transform')
  return { blocks, params: { ...params, ...transform(params) } }
}

describe('Confluence search-in-space values saved before the selector split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(ConfluenceV2Block)
  })

  it.each([
    {
      mode: 'basic',
      source: 'spaceSelector',
      target: 'spaceKeySelector',
      value: 'ENG',
      advancedMode: false,
    },
    {
      mode: 'advanced',
      source: 'spaceId',
      target: 'manualSpaceKey',
      value: '12345',
      advancedMode: true,
    },
  ])('migrates the $mode value and sends it as spaceKey', (testCase) => {
    const { blocks, params } = mappedSearchParams(
      legacySearchBlock(testCase.source, testCase.value, testCase.advancedMode)
    )

    expect(blocks['block-1'].subBlocks[testCase.target]?.value).toBe(testCase.value)
    expect(params).toMatchObject({ operation: 'search_in_space', spaceKey: testCase.value })
    expect(params.spaceId).toBeUndefined()
  })
})
