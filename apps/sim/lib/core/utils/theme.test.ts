/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncThemeToNextThemes } from '@/lib/core/utils/theme'

describe('syncThemeToNextThemes', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('light', 'dark')
    vi.restoreAllMocks()
  })

  it('does not dispatch or rewrite classes when the requested theme is already applied', () => {
    localStorage.setItem('sim-theme', 'dark')
    document.documentElement.classList.add('dark')
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')
    const remove = vi.spyOn(document.documentElement.classList, 'remove')
    const add = vi.spyOn(document.documentElement.classList, 'add')

    syncThemeToNextThemes('dark')

    expect(dispatchEvent).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('repairs the document class without emitting a redundant storage event', () => {
    localStorage.setItem('sim-theme', 'dark')
    document.documentElement.classList.add('light')
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')

    syncThemeToNextThemes('dark')

    expect(dispatchEvent).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })
})
