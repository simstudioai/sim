/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

const { synthRegistry } = vi.hoisted(() => ({
  synthRegistry: {
    slack: {
      type: 'slack',
      name: 'Slack',
      description: '',
      category: 'tools',
      bgColor: '#000',
      icon: () => null,
      subBlocks: [],
      tools: { access: [] },
      inputs: {},
      outputs: {},
    },
  },
}))

vi.mock('@/blocks/registry-maps', () => ({
  BLOCK_REGISTRY: synthRegistry,
  BLOCK_META_REGISTRY: {},
}))

import { getAllBlocks } from '@/blocks/registry'
import { registerBlockVisibilityResolver } from '@/blocks/visibility/context'

afterEach(() => registerBlockVisibilityResolver(null))

describe('registry fast path (no preview blocks registered)', () => {
  it('returns raw references with no context', () => {
    expect(getAllBlocks()[0]).toBe(synthRegistry.slack)
  })

  it('returns raw references when the active state has no kill-switch entries', () => {
    const state = {
      revealed: new Set(['whatever']),
      disabled: new Set<string>(),
      previewTagged: new Set(['whatever']),
    }
    registerBlockVisibilityResolver({ current: () => state })
    expect(getAllBlocks()[0]).toBe(synthRegistry.slack)
  })

  it('still projects when a kill-switch entry applies', () => {
    const state = {
      revealed: new Set<string>(),
      disabled: new Set(['slack']),
      previewTagged: new Set<string>(),
    }
    registerBlockVisibilityResolver({ current: () => state })
    expect(getAllBlocks()[0]?.hideFromToolbar).toBe(true)
    expect(synthRegistry.slack).not.toHaveProperty('hideFromToolbar', true)
  })
})
