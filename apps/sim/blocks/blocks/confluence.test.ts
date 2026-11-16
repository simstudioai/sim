import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { ConfluenceV2Block } from '@/blocks/blocks/confluence'
import { getBlock } from '@/blocks/registry'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

const mockGetBlock = vi.mocked(getBlock)

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

/**
 * On a tool call the model supplies args under the tool's param names and the operation arrives
 * only in `context`; the handler forwards `{ ...args, ...mapped }`.
 */
describe('ConfluenceV2Block tool calls', () => {
  const toolCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => ({
    ...args,
    ...ConfluenceV2Block.tools.config?.params?.(args, { operation }),
  })

  it('normalizes the model file on upload_attachment', () => {
    const file = { name: 'a.txt', key: 'k', size: 1, type: 'text/plain' }
    expect(toolCall('upload_attachment', { pageId: '1', file: [file] }).file).toEqual(file)
  })

  it('keeps the model args the operation branches rename', () => {
    expect(toolCall('search_in_space', { spaceKey: 'ENG', cursor: 'c' })).toMatchObject({
      spaceKey: 'ENG',
      cursor: 'c',
    })
    expect(toolCall('search', { query: 'q', cursor: 'c' }).cursor).toBe('c')
    expect(toolCall('delete_space_property', { spaceId: 's', propertyId: 'p' }).propertyId).toBe(
      'p'
    )
    expect(toolCall('create_page_property', { pageId: '1', key: 'k', value: 1 }).key).toBe('k')
  })
})
