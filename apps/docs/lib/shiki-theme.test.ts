/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { simShikiOptions } from '@/lib/shiki-theme'

function luminance(hex: string) {
  const values = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}

describe('docs syntax contrast', () => {
  for (const [name, theme] of Object.entries(simShikiOptions.themes)) {
    it(`keeps every ${name} syntax token readable on its code surface`, () => {
      const background = luminance(theme.settings[0].settings.background!)
      for (const token of theme.settings) {
        if (!token.settings.foreground) continue
        const foreground = luminance(token.settings.foreground)
        const ratio =
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        expect(ratio, `${name}: ${token.scope ?? 'base'}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
