/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

const { synthRegistry } = vi.hoisted(() => {
  const block = (type: string, extra: Record<string, unknown> = {}) => ({
    type,
    name: type.toUpperCase(),
    description: '',
    category: 'tools',
    bgColor: '#000',
    icon: () => null,
    subBlocks: [],
    tools: { access: [] },
    inputs: {},
    outputs: {},
    ...extra,
  })
  return {
    synthRegistry: {
      slack: block('slack'),
      gmail_v2: block('gmail_v2', { preview: true }),
      old_v1: block('old_v1', { hideFromToolbar: true }),
    },
  }
})

vi.mock('@/blocks/registry-maps', () => ({
  BLOCK_REGISTRY: synthRegistry,
  BLOCK_META_REGISTRY: {},
}))

import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { registerBlockOverlayResolver } from '@/blocks/custom/overlay'
import { getAllBlocks, getBlock, getCanonicalBlocksByCategory } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { isHiddenUnder, registerBlockVisibilityResolver } from '@/blocks/visibility/context'

function vis(partial: Partial<BlockVisibilityState> = {}): BlockVisibilityState {
  return {
    revealed: new Set(),
    disabled: new Set(),
    previewTagged: new Set(),
    ...partial,
  }
}

function withVisibility(state: BlockVisibilityState | null) {
  registerBlockVisibilityResolver(state ? { current: () => state } : null)
}

const byType = (blocks: BlockConfig[], type: string) => blocks.find((b) => b.type === type)

afterEach(() => {
  registerBlockVisibilityResolver(null)
  registerBlockOverlayResolver(null)
})

describe('isHiddenUnder', () => {
  it('hides unrevealed preview blocks even with a null state (fail-closed)', () => {
    expect(isHiddenUnder(null, { type: 'gmail_v2', preview: true })).toBe(true)
    expect(isHiddenUnder(null, { type: 'slack' })).toBe(false)
  })

  it('reveals preview blocks named in revealed', () => {
    const state = vis({ revealed: new Set(['gmail_v2']) })
    expect(isHiddenUnder(state, { type: 'gmail_v2', preview: true })).toBe(false)
  })

  it('hides kill-switched types only with an active state', () => {
    const state = vis({ disabled: new Set(['slack']) })
    expect(isHiddenUnder(state, { type: 'slack' })).toBe(true)
    expect(isHiddenUnder(null, { type: 'slack' })).toBe(false)
  })
})

describe('registry projection', () => {
  it('hides preview blocks without any context: clone-not-remove', () => {
    withVisibility(null)
    const all = getAllBlocks()
    const gmail = byType(all, 'gmail_v2')
    expect(gmail).toBeDefined()
    expect(gmail?.hideFromToolbar).toBe(true)
    // the underlying registry entry is untouched
    expect(getBlock('gmail_v2')?.hideFromToolbar).toBeUndefined()
    // canonical (filtered) set excludes it
    expect(byType(getCanonicalBlocksByCategory('tools'), 'gmail_v2')).toBeUndefined()
  })

  it('reveals a preview block with a " (Preview)" display suffix when tagged', () => {
    withVisibility(vis({ revealed: new Set(['gmail_v2']), previewTagged: new Set(['gmail_v2']) }))
    expect(byType(getAllBlocks(), 'gmail_v2')?.name).toBe('GMAIL_V2 (Preview)')
    const canonical = byType(getCanonicalBlocksByCategory('tools'), 'gmail_v2')
    expect(canonical?.name).toBe('GMAIL_V2 (Preview)')
    expect(canonical?.hideFromToolbar).toBeUndefined()
  })

  it('reveals a config-GA preview block without a suffix', () => {
    withVisibility(vis({ revealed: new Set(['gmail_v2']) }))
    expect(byType(getAllBlocks(), 'gmail_v2')?.name).toBe('GMAIL_V2')
  })

  it('kill-switches a shipped block only when a context is active', () => {
    withVisibility(vis({ disabled: new Set(['slack']) }))
    expect(byType(getAllBlocks(), 'slack')?.hideFromToolbar).toBe(true)
    expect(byType(getCanonicalBlocksByCategory('tools'), 'slack')).toBeUndefined()

    withVisibility(null)
    expect(byType(getAllBlocks(), 'slack')?.hideFromToolbar).toBeUndefined()
  })

  it('keeps getBlock pure regardless of visibility', () => {
    withVisibility(
      vis({
        revealed: new Set(['gmail_v2']),
        previewTagged: new Set(['gmail_v2']),
        disabled: new Set(['slack']),
      })
    )
    expect(getBlock('gmail_v2')?.name).toBe('GMAIL_V2')
    expect(getBlock('slack')?.hideFromToolbar).toBeUndefined()
  })

  it('returns untouched references for unaffected blocks', () => {
    withVisibility(vis({ revealed: new Set(['gmail_v2']) }))
    expect(byType(getAllBlocks(), 'slack')).toBe(synthRegistry.slack)
    expect(byType(getAllBlocks(), 'old_v1')).toBe(synthRegistry.old_v1)
  })

  it('never re-clones or suffixes already-hidden custom blocks', () => {
    const disabledCustom = {
      ...synthRegistry.slack,
      type: 'custom_block_abc',
      name: 'My Custom',
      hideFromToolbar: true,
    } as BlockConfig
    registerBlockOverlayResolver({
      get: (t) => (t === disabledCustom.type ? disabledCustom : undefined),
      all: () => [disabledCustom],
    })
    withVisibility(vis({ revealed: new Set(['gmail_v2']) }))
    const projected = byType(getAllBlocks(), 'custom_block_abc')
    expect(projected).toBe(disabledCustom)
    expect(projected?.name).toBe('My Custom')
  })
})
