/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeShellPage } from '@/renderer/shell'
import type { ShellTheme, ShellThemeApi } from '@/shared/shell'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shell appearance bootstrap', () => {
  it('keeps a newer theme received while the initial snapshot is pending', async () => {
    let resolveInitial!: (theme: ShellTheme) => void
    let update!: (theme: ShellTheme) => void
    const api: ShellThemeApi = {
      get: () =>
        new Promise((resolve) => {
          resolveInitial = resolve
        }),
      onChange: (callback) => {
        update = callback
        return () => {}
      },
    }
    vi.stubGlobal('simShellTheme', api)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() }))
    )
    const ready = initializeShellPage()
    update('light')
    resolveInitial('dark')
    await ready
    expect(document.documentElement.className).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('follows system changes only before an app theme is known', async () => {
    let update!: (theme: ShellTheme) => void
    let systemChanged!: () => void
    const media = {
      matches: true,
      addEventListener: vi.fn((_event, callback) => {
        systemChanged = callback
      }),
    }
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media)
    )
    vi.stubGlobal('simShellTheme', {
      get: async () => undefined,
      onChange: (callback) => {
        update = callback
        return () => {}
      },
    } satisfies ShellThemeApi)
    await initializeShellPage()
    expect(document.documentElement.className).toBe('dark')
    media.matches = false
    systemChanged()
    expect(document.documentElement.className).toBe('light')
    update('dark')
    systemChanged()
    expect(document.documentElement.className).toBe('dark')
  })
})
