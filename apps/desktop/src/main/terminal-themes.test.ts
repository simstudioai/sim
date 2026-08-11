import { TERMINAL_DARK_THEME, TERMINAL_LIGHT_THEME } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import { parseTerminalThemeProfiles } from '@/main/terminal-themes'

const PALETTE = {
  ...TERMINAL_DARK_THEME,
  background: '#101010',
}
const LIGHT_PALETTE = {
  ...TERMINAL_LIGHT_THEME,
  background: '#fafafa',
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Ocean',
    source: 'iterm2',
    palette: PALETTE,
    ...overrides,
  }
}

describe('parseTerminalThemeProfiles', () => {
  it('accepts color-only Terminal and iTerm2 profiles', () => {
    expect(parseTerminalThemeProfiles([profile('iterm2:ocean')])).toEqual([profile('iterm2:ocean')])
  })

  it('preserves separate iTerm2 light and dark palettes', () => {
    const separateProfile = profile('iterm2:ocean', {
      lightPalette: LIGHT_PALETTE,
      darkPalette: PALETTE,
    })

    expect(parseTerminalThemeProfiles([separateProfile])).toEqual([separateProfile])
  })

  it('drops malformed colors and unsupported applications', () => {
    expect(
      parseTerminalThemeProfiles([
        profile('bad-color', { palette: { ...PALETTE, background: 'rgb(0, 0, 0)' } }),
        profile('bad-mode-color', {
          lightPalette: { ...LIGHT_PALETTE, foreground: 'white' },
        }),
        profile('bad-source', { source: 'warp' }),
      ])
    ).toEqual([])
  })

  it('keeps only the first profile when ids collide', () => {
    expect(
      parseTerminalThemeProfiles([
        profile('terminal:basic', {
          name: 'Basic',
          source: 'terminal',
        }),
        profile('terminal:basic', {
          name: 'Impostor',
          source: 'terminal',
        }),
      ])
    ).toEqual([
      profile('terminal:basic', {
        name: 'Basic',
        source: 'terminal',
      }),
    ])
  })
})
