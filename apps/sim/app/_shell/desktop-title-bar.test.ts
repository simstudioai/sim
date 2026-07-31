/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { applyDesktopTitleBarMode, supportsDesktopTitleBar } from '@/app/_shell/desktop-title-bar'

describe('desktop title bar', () => {
  it('reserves traffic-light space on macOS desktop, and nowhere else', () => {
    // No route check by design — mounting the controller is the signal, and only
    // `AuthShell` mounts it. A route list could not cover `/invite/[id]`.
    expect(supportsDesktopTitleBar('Macintosh', true)).toBe(true)
    expect(supportsDesktopTitleBar('Windows NT 10.0', true)).toBe(false)
    expect(supportsDesktopTitleBar('Macintosh', false)).toBe(false)
  })

  it('sets, updates, and removes the shared document marker', () => {
    const root = document.documentElement

    applyDesktopTitleBarMode(root, 'inset')
    expect(root.getAttribute('data-sim-desktop-title-bar')).toBe('inset')

    applyDesktopTitleBarMode(root, 'fullscreen')
    expect(root.getAttribute('data-sim-desktop-title-bar')).toBe('fullscreen')

    applyDesktopTitleBarMode(root, null)
    expect(root.hasAttribute('data-sim-desktop-title-bar')).toBe(false)
  })
})
