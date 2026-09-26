/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { initializeShellPage } from '@/renderer/shell'
import type { ShellTheme, ShellThemeApi } from '@/shared/shell'

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
    expect(document.documentElement.className).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    update('light')
    resolveInitial('dark')
    await ready
    expect(document.documentElement.className).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
