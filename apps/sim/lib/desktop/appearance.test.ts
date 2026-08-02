import { TERMINAL_DARK_THEME } from '@sim/desktop-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockBridge } = vi.hoisted(() => ({ mockBridge: { current: undefined as unknown } }))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => mockBridge.current,
}))

import {
  loadDesktopTerminalAppearance,
  loadDesktopTerminalThemeProfiles,
  resolveDesktopAppearanceTheme,
} from './appearance'

afterEach(() => {
  mockBridge.current = undefined
})

describe('resolveDesktopAppearanceTheme', () => {
  it('follows the app theme by default', () => {
    expect(resolveDesktopAppearanceTheme('app', 'system')).toBe('system')
    expect(resolveDesktopAppearanceTheme('app', 'light')).toBe('light')
    expect(resolveDesktopAppearanceTheme('app', 'dark')).toBe('dark')
  })

  it('keeps an explicit surface override', () => {
    expect(resolveDesktopAppearanceTheme('light', 'dark')).toBe('light')
    expect(resolveDesktopAppearanceTheme('dark', 'light')).toBe('dark')
  })

  it('falls back safely before the app theme resolves', () => {
    expect(resolveDesktopAppearanceTheme('app', undefined)).toBe('system')
    expect(resolveDesktopAppearanceTheme('app', 'unexpected')).toBe('system')
  })
})

describe('loadDesktopTerminalAppearance', () => {
  it('returns a cached profile selection without waiting for source discovery', async () => {
    const selectedProfile = {
      id: 'iterm2:ocean',
      name: 'Ocean',
      source: 'iterm2' as const,
      palette: {
        ...TERMINAL_DARK_THEME,
        background: '#101010',
      },
    }
    const listProfiles = vi.fn(async () => [selectedProfile])
    mockBridge.current = {
      settings: {
        getPreferences: vi.fn(async () => ({
          notificationsEnabled: true,
          notificationSounds: true,
          notificationsOnlyWhenUnfocused: true,
          launchAtLogin: false,
          autoDownloadUpdates: true,
          terminalTheme: selectedProfile,
          terminalDefaultZoom: 125,
        })),
      },
      terminalThemes: { listProfiles },
    }

    await expect(loadDesktopTerminalAppearance()).resolves.toEqual({
      theme: selectedProfile,
      defaultZoom: 125,
    })
    expect(listProfiles).not.toHaveBeenCalled()
    await expect(loadDesktopTerminalThemeProfiles()).resolves.toEqual([selectedProfile])
  })
  it('falls back to actual size when the shell has no valid baseline', async () => {
    mockBridge.current = {
      settings: {
        getPreferences: vi.fn(async () => ({
          terminalDefaultZoom: 123,
        })),
      },
    }

    await expect(loadDesktopTerminalAppearance()).resolves.toMatchObject({ defaultZoom: 100 })
    mockBridge.current = undefined
    await expect(loadDesktopTerminalAppearance()).resolves.toMatchObject({ defaultZoom: 100 })
  })
})
