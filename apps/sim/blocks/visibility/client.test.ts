/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNotify } = vi.hoisted(() => ({ mockNotify: vi.fn() }))

vi.mock('@/blocks/custom/client-overlay', () => ({
  notifyBlockOverlayChanged: mockNotify,
}))

import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
// client-boundary-allow: vitest ignores the 'use client' directive; this node-env test exercises the module directly
import { hydrateBlockVisibility } from '@/blocks/visibility/client'
import { overlayVisibility, registerBlockCacheInvalidator } from '@/blocks/visibility/context'

function state(revealed: string[], disabled: string[] = []): BlockVisibilityState {
  return {
    revealed: new Set(revealed),
    disabled: new Set(disabled),
    previewTagged: new Set(revealed),
  }
}

describe('hydrateBlockVisibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies state, fires invalidators, and bumps the overlay version', () => {
    const invalidator = vi.fn()
    const unregister = registerBlockCacheInvalidator(invalidator)

    hydrateBlockVisibility(state(['gmail_v2']))
    expect(overlayVisibility()?.revealed.has('gmail_v2')).toBe(true)
    expect(invalidator).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)

    unregister()
  })

  it('no-ops on a deep-equal state (fresh objects, same content)', () => {
    const invalidator = vi.fn()
    const unregister = registerBlockCacheInvalidator(invalidator)

    hydrateBlockVisibility(state(['gmail_v2'], ['slack']))
    hydrateBlockVisibility(state(['gmail_v2'], ['slack']))
    expect(invalidator).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)

    hydrateBlockVisibility(state(['gmail_v2', 'notion_v3'], ['slack']))
    expect(invalidator).toHaveBeenCalledTimes(2)
    expect(mockNotify).toHaveBeenCalledTimes(2)

    unregister()
  })
})
