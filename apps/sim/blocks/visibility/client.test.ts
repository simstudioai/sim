import { describe, expect, it, vi } from 'vitest'

const { mockNotify } = vi.hoisted(() => ({ mockNotify: vi.fn() }))

vi.mock('@/blocks/custom/client-overlay', () => ({
  notifyBlockOverlayChanged: mockNotify,
}))

import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
// client-boundary-allow: vitest ignores the 'use client' directive; this node-env test exercises the module directly
import { hydrateBlockVisibility, resetBlockVisibilityForSwitch } from '@/blocks/visibility/client'
import { overlayVisibility, registerBlockCacheInvalidator } from '@/blocks/visibility/context'

function state(revealed: string[], disabled: string[] = []): BlockVisibilityState {
  return {
    revealed: new Set(revealed),
    disabled: new Set(disabled),
    previewTagged: new Set(revealed),
  }
}

describe('hydrateBlockVisibility', () => {
  it('applies state, fires invalidators, and bumps the overlay version', () => {
    const invalidator = vi.fn()
    const unregister = registerBlockCacheInvalidator(invalidator)

    hydrateBlockVisibility(state(['gmail_v2']))
    expect(overlayVisibility()?.revealed.has('gmail_v2')).toBe(true)
    expect(invalidator).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)

    unregister()
  })

  it('drops reveals but carries kill switches over on workspace switch', () => {
    const invalidator = vi.fn()
    const unregister = registerBlockCacheInvalidator(invalidator)

    // Reveal + kill-switch in workspace A, then switch (loader resets while the
    // new projection loads). (notion_v3: distinct from prior tests' state —
    // module state persists.)
    hydrateBlockVisibility(state(['notion_v3'], ['slack']))
    resetBlockVisibilityForSwitch()
    expect(overlayVisibility()?.revealed.size).toBe(0)
    expect(overlayVisibility()?.previewTagged.size).toBe(0)
    expect(overlayVisibility()?.disabled).toEqual(new Set(['slack']))
    expect(invalidator).toHaveBeenCalledTimes(2)

    // Repeated resets are no-ops (deep-equal).
    resetBlockVisibilityForSwitch()
    expect(invalidator).toHaveBeenCalledTimes(2)

    unregister()
  })
})
