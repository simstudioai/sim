import { describe, expect, it } from 'vitest'
import { withAlpha } from '@/lib/workspaces/colors'

describe('collaborator colours', () => {
  it('accepts hex colours from peers running an older client', () => {
    expect(withAlpha('#F472B6', 0.2)).toBe('rgba(244, 114, 182, 0.2)')
    expect(withAlpha('#000', 0.2)).toBe('rgba(0, 0, 0, 0.2)')
  })

  it('clamps opacity for CSS and hex colours', () => {
    expect(withAlpha('var(--color-black)', -1)).toBe(
      'color-mix(in srgb, var(--color-black) 0%, transparent)'
    )
    expect(withAlpha('var(--color-black)', 2)).toBe(
      'color-mix(in srgb, var(--color-black) 100%, transparent)'
    )
    expect(withAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)')
    expect(withAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)')
  })
})
