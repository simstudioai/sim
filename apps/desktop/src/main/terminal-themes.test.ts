import type { TerminalThemePalette } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import { parseTerminalThemeProfiles } from '@/main/terminal-themes'

const PALETTE: TerminalThemePalette = {
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: '#ffffff',
  cursorAccent: '#101010',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
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
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Ocean',
    source: 'iterm2',
    sourceLabel: 'iTerm2',
    isDefault: true,
    palette: PALETTE,
    ...overrides,
  }
}

describe('parseTerminalThemeProfiles', () => {
  it('accepts color-only Terminal and iTerm2 profile metadata', () => {
    expect(parseTerminalThemeProfiles([profile('iterm2:ocean')])).toEqual([profile('iterm2:ocean')])
  })

  it('drops malformed colors and unsupported applications', () => {
    expect(
      parseTerminalThemeProfiles([
        profile('bad-color', { palette: { ...PALETTE, background: 'rgb(0, 0, 0)' } }),
        profile('bad-source', { source: 'warp', sourceLabel: 'Warp' }),
      ])
    ).toEqual([])
  })

  it('keeps only the first profile when ids collide', () => {
    expect(
      parseTerminalThemeProfiles([
        profile('terminal:basic', {
          name: 'Basic',
          source: 'terminal',
          sourceLabel: 'Terminal',
        }),
        profile('terminal:basic', {
          name: 'Impostor',
          source: 'terminal',
          sourceLabel: 'Terminal',
        }),
      ])
    ).toEqual([
      profile('terminal:basic', {
        name: 'Basic',
        source: 'terminal',
        sourceLabel: 'Terminal',
      }),
    ])
  })
})
