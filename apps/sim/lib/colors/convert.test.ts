/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, toCssColor } from '@/lib/colors/convert'

describe('hexToRgb', () => {
  it('parses 6- and 3-digit hex, with or without #', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 })
    expect(hexToRgb('f80')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('returns black for malformed input', () => {
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('rgbToHex', () => {
  it('clamps and pads to #rrggbb', () => {
    expect(rgbToHex(255, 136, 0)).toBe('#ff8800')
    expect(rgbToHex(-10, 300, 5)).toBe('#00ff05')
  })
})

describe('rgbToHsl / hslToRgb round-trip', () => {
  it('round-trips a saturated color within rounding', () => {
    const { h, s, l } = rgbToHsl(59, 130, 246)
    const { r, g, b } = hslToRgb(h, s, l)
    expect(Math.abs(r - 59)).toBeLessThanOrEqual(1)
    expect(Math.abs(g - 130)).toBeLessThanOrEqual(1)
    expect(Math.abs(b - 246)).toBeLessThanOrEqual(1)
  })

  it('handles grays (zero saturation)', () => {
    expect(hslToRgb(0, 0, 0.5)).toEqual({ r: 128, g: 128, b: 128 })
  })
})

describe('toCssColor', () => {
  it('returns bare hex when fully opaque', () => {
    expect(toCssColor('#3b82f6', 1)).toBe('#3b82f6')
    expect(toCssColor('3b82f6', 1)).toBe('#3b82f6')
  })

  it('returns rgba with 3-decimal alpha when translucent', () => {
    expect(toCssColor('#3b82f6', 0.5)).toBe('rgba(59,130,246,0.500)')
  })
})
