/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { applyDesktopTitleBarMode, supportsDesktopTitleBar } from '@/app/_shell/desktop-title-bar'

describe('desktop title bar', () => {
  it('reserves traffic-light space only for desktop login on macOS', () => {
    expect(supportsDesktopTitleBar('/login', 'Macintosh', true)).toBe(true)
    expect(supportsDesktopTitleBar('/workspace/ws/home', 'Macintosh', true)).toBe(false)
    expect(supportsDesktopTitleBar('/signup', 'Macintosh', true)).toBe(false)
    expect(supportsDesktopTitleBar('/desktop/connect', 'Macintosh', true)).toBe(false)
    expect(supportsDesktopTitleBar('/login', 'Windows NT 10.0', true)).toBe(false)
    expect(supportsDesktopTitleBar('/login', 'Macintosh', false)).toBe(false)
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
