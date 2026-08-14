/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  focusVisibleBrowserOmnibox,
  onFocusVisibleBrowserOmnibox,
} from '@/lib/browser-agent/renderer-shortcuts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('visible browser omnibox shortcut', () => {
  it('is unclaimed when no browser panel is visible', () => {
    expect(focusVisibleBrowserOmnibox()).toBe(false)
  })

  it('is claimed synchronously by the visible browser panel', () => {
    const focus = vi.fn()
    cleanups.push(onFocusVisibleBrowserOmnibox(focus))

    expect(focusVisibleBrowserOmnibox()).toBe(true)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('stops claiming the shortcut when the panel unregisters', () => {
    const cleanup = onFocusVisibleBrowserOmnibox(vi.fn())
    cleanup()

    expect(focusVisibleBrowserOmnibox()).toBe(false)
  })
})
