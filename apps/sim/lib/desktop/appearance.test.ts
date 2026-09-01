import { TERMINAL_DARK_THEME, TERMINAL_LIGHT_THEME } from '@sim/desktop-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockBridge } = vi.hoisted(() => ({ mockBridge: { current: undefined as unknown } }))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => mockBridge.current,
}))

import {
  loadDesktopTerminalAppearance,
  loadDesktopTerminalThemeProfiles,
  refreshSelectedTerminalProfile,
  resolveDesktopAppearanceTheme,
  resolveTerminalThemePalette,
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

describe('resolveTerminalThemePalette', () => {
  const fallbackPalette = { ...TERMINAL_DARK_THEME, background: '#111111' }
  const lightPalette = { ...TERMINAL_LIGHT_THEME, background: '#fafafa' }
  const darkPalette = { ...TERMINAL_DARK_THEME, background: '#222222' }
  const profile = {
    id: 'iterm2:ocean',
    name: 'Ocean',
    source: 'iterm2' as const,
    palette: fallbackPalette,
    lightPalette,
    darkPalette,
  }

  it('uses an imported profile palette matching Sim appearance', () => {
    expect(resolveTerminalThemePalette(profile, 'light')).toBe(lightPalette)
    expect(resolveTerminalThemePalette(profile, 'dark')).toBe(darkPalette)
  })

  it('falls back to the source palette when a profile has no mode-specific colors', () => {
    const legacyProfile = { ...profile, lightPalette: undefined, darkPalette: undefined }
    expect(resolveTerminalThemePalette(legacyProfile, 'light')).toBe(fallbackPalette)
    expect(resolveTerminalThemePalette(legacyProfile, 'dark')).toBe(fallbackPalette)
  })

  it('keeps built-in Sim themes unchanged', () => {
    expect(resolveTerminalThemePalette('light', 'dark')).toBe(TERMINAL_LIGHT_THEME)
    expect(resolveTerminalThemePalette('dark', 'light')).toBe(TERMINAL_DARK_THEME)
  })
})

describe('refreshSelectedTerminalProfile', () => {
  const storedProfile = {
    id: 'iterm2:ocean',
    name: 'Ocean',
    source: 'iterm2' as const,
    palette: { ...TERMINAL_DARK_THEME, background: '#111111' },
  }
  const refreshedProfile = {
    ...storedProfile,
    palette: { ...storedProfile.palette, background: '#222222' },
  }

  it('uses newly discovered colors for the active source profile', () => {
    expect(refreshSelectedTerminalProfile([refreshedProfile], storedProfile)).toBe(refreshedProfile)
  })

  it('keeps built-in and unavailable profile selections unchanged', () => {
    expect(refreshSelectedTerminalProfile([refreshedProfile], 'app')).toBe('app')
    expect(refreshSelectedTerminalProfile([], storedProfile)).toBe(storedProfile)
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
