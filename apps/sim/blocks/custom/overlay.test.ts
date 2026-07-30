/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildCustomBlockConfig } from '@/blocks/custom/build-config'
import {
  overlayBlocks,
  registerBlockOverlayResolver,
  resolveOverlayBlock,
} from '@/blocks/custom/overlay'
import type { BlockIcon } from '@/blocks/types'

const icon: BlockIcon = () => null as never

const config = buildCustomBlockConfig(
  { type: 'custom_block_xyz', name: 'X', description: '', workflowId: 'wf-9' },
  [],
  { icon }
)

afterEach(() => registerBlockOverlayResolver(null))

describe('block overlay resolver', () => {
  it('returns undefined/empty with no resolver registered', () => {
    expect(resolveOverlayBlock('custom_block_xyz')).toBeUndefined()
    expect(overlayBlocks()).toEqual([])
  })

  it('resolves through a registered resolver and clears on null', () => {
    const map = new Map([[config.type, config]])
    registerBlockOverlayResolver({ get: (t) => map.get(t), all: () => [...map.values()] })

    expect(resolveOverlayBlock('custom_block_xyz')).toBe(config)
    expect(resolveOverlayBlock('nope')).toBeUndefined()
    expect(overlayBlocks()).toEqual([config])

    registerBlockOverlayResolver(null)
    expect(resolveOverlayBlock('custom_block_xyz')).toBeUndefined()
    expect(overlayBlocks()).toEqual([])
  })
})
