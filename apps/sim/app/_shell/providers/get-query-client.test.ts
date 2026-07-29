/**
 * @vitest-environment jsdom
 */
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { afterEach, describe, expect, it } from 'vitest'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'

function focusRefetchDefault(): boolean | 'always' | ((...args: unknown[]) => boolean) | undefined {
  return makeQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus
}

describe('makeQueryClient refetchOnWindowFocus default', () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: test teardown of a global stub
    delete (window as { simDesktop?: SimDesktopApi }).simDesktop
  })

  it('is off on the web (no desktop bridge) — tab-switch focus is noisy there', () => {
    expect(focusRefetchDefault()).toBe(false)
  })

  it('is on in the desktop app — refetches stale queries when the long-lived window refocuses', () => {
    ;(window as { simDesktop?: SimDesktopApi }).simDesktop = {} as SimDesktopApi
    expect(focusRefetchDefault()).toBe(true)
  })
})
