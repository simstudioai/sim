import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockBridge } = vi.hoisted(() => ({ mockBridge: { current: undefined as unknown } }))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => mockBridge.current,
}))

import { loadDesktopTerminalAppearance, resolveDesktopAppearanceTheme } from './appearance'

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
  it('returns the cached selection and currently available source profiles', async () => {
    const selectedProfile = {
      id: 'iterm2:ocean',
      name: 'Ocean',
      source: 'iterm2' as const,
      palette: {
        background: '#101010',
        foreground: '#f0f0f0',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cc0000',
        green: '#00cc00',
        yellow: '#cccc00',
        blue: '#0000cc',
        magenta: '#cc00cc',
        cyan: '#00cccc',
        white: '#cccccc',
        brightBlack: '#555555',
        brightRed: '#ff5555',
        brightGreen: '#55ff55',
        brightYellow: '#ffff55',
        brightBlue: '#5555ff',
        brightMagenta: '#ff55ff',
        brightCyan: '#55ffff',
        brightWhite: '#ffffff',
      },
    }
    mockBridge.current = {
      settings: {
        getPreferences: vi.fn(async () => ({
          notificationsEnabled: true,
          notificationSounds: true,
          notificationsOnlyWhenUnfocused: true,
          launchAtLogin: false,
          autoDownloadUpdates: true,
          terminalTheme: 'profile:iterm2:ocean',
          terminalProfile: selectedProfile,
        })),
      },
      terminalThemes: {
        listProfiles: vi.fn(async () => [
          { ...selectedProfile, sourceLabel: 'iTerm2', isDefault: true },
        ]),
      },
    }

    await expect(loadDesktopTerminalAppearance()).resolves.toEqual({
      theme: 'profile:iterm2:ocean',
      selectedProfile,
      profiles: [{ ...selectedProfile, sourceLabel: 'iTerm2', isDefault: true }],
    })
  })
})
