import type { BlockState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBBLOCK_TYPE, mergeSubblockStateWithValues } from './subblocks'

function buildBlock(subBlocks: BlockState['subBlocks']): BlockState {
  return {
    id: 'block-1',
    type: 'api',
    name: 'API',
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
  } as BlockState
}

function buildBlocks(subBlocks: BlockState['subBlocks']): Record<string, BlockState> {
  return { 'block-1': buildBlock(subBlocks) }
}

describe('mergeSubblockStateWithValues', () => {
  it('overrides structure values with non-null store values', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, {
      'block-1': { channel: 'new-channel' },
    })

    expect(merged['block-1'].subBlocks.channel.value).toBe('new-channel')
  })

  it('overrides structure values with explicit null (cleared field)', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, {
      'block-1': { channel: null },
    })

    expect(merged['block-1'].subBlocks.channel.value).toBeNull()
  })

  it('keeps structure values when the key is absent from the values map', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, { 'block-1': {} })

    expect(merged['block-1'].subBlocks.channel.value).toBe('old-channel')
  })

  it('treats undefined values as absent', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, {
      'block-1': { channel: undefined },
    })

    expect(merged['block-1'].subBlocks.channel.value).toBe('old-channel')
  })

  it('does not create entries for null values missing from the structure', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, {
      'block-1': { webhookId: null },
    })

    expect(merged['block-1'].subBlocks.webhookId).toBeUndefined()
  })

  it('creates minimal entries for non-null values missing from the structure', () => {
    const blocks = buildBlocks({
      channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
    })

    const merged = mergeSubblockStateWithValues(blocks, {
      'block-1': { webhookId: 'wh-123' },
    })

    expect(merged['block-1'].subBlocks.webhookId).toEqual({
      id: 'webhookId',
      type: DEFAULT_SUBBLOCK_TYPE,
      value: 'wh-123',
    })
  })

  it('merges only the requested block when blockId is provided', () => {
    const blocks: Record<string, BlockState> = {
      'block-1': buildBlock({
        channel: { id: 'channel', type: 'short-input', value: 'old-channel' },
      }),
      'block-2': buildBlock({
        channel: { id: 'channel', type: 'short-input', value: 'other' },
      }),
    }

    const merged = mergeSubblockStateWithValues(
      blocks,
      { 'block-1': { channel: null }, 'block-2': { channel: null } },
      'block-1'
    )

    expect(Object.keys(merged)).toEqual(['block-1'])
    expect(merged['block-1'].subBlocks.channel.value).toBeNull()
  })

  it('skips unknown block ids without throwing', () => {
    const merged = mergeSubblockStateWithValues(buildBlocks({}), {}, 'missing-block')

    expect(merged).toEqual({})
  })
})
