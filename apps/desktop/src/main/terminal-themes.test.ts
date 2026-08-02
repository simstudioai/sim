import { TERMINAL_DARK_THEME } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import { parseTerminalThemeProfiles } from '@/main/terminal-themes'

const PALETTE = {
  ...TERMINAL_DARK_THEME,
  background: '#101010',
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

  it('drops malformed colors and unsupported applications', () => {
    expect(
      parseTerminalThemeProfiles([
        profile('bad-color', { palette: { ...PALETTE, background: 'rgb(0, 0, 0)' } }),
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
