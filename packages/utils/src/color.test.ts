import { describe, expect, it } from 'vitest'
import { perceivedBackgroundBrightness, perceivedBrightness } from './color'

describe('perceivedBrightness', () => {
  it('returns 1 for white and 0 for black (hex and keywords)', () => {
    expect(perceivedBrightness('#ffffff')).toBe(1)
    expect(perceivedBrightness('#000000')).toBe(0)
    expect(perceivedBrightness('white')).toBe(1)
    expect(perceivedBrightness('black')).toBe(0)
  })

  it('parses 3-digit hex, optional # and quotes, case-insensitively', () => {
    expect(perceivedBrightness('#FFF')).toBe(1)
    expect(perceivedBrightness('fff')).toBe(1)
    expect(perceivedBrightness("'#FFFFFF'")).toBe(1)
  })

  it('returns null for non-color values', () => {
    expect(perceivedBrightness('currentColor')).toBeNull()
    expect(perceivedBrightness('linear-gradient(45deg, #000, #fff)')).toBeNull()
    expect(perceivedBrightness('rebeccapurple')).toBeNull()
    expect(perceivedBrightness('#12')).toBeNull()
  })

  it('reads saturated brand colors perceptually (bright yellow is light)', () => {
    expect((perceivedBrightness('#EAB308') as number) > 0.6).toBe(true)
    expect((perceivedBrightness('#3B82F6') as number) < 0.6).toBe(true)
  })
})

describe('perceivedBackgroundBrightness', () => {
  it('preserves solid-color brightness', () => {
    expect(perceivedBackgroundBrightness('#ffffff')).toBe(1)
    expect(perceivedBackgroundBrightness('#000000')).toBe(0)
  })

  it('averages supported CSS gradient stops', () => {
    expect(
      perceivedBackgroundBrightness('linear-gradient(180deg, #E0F7FA 0%, #FFFFFF 100%)')
    ).toBeCloseTo(0.9715)
    expect(perceivedBackgroundBrightness('linear-gradient(45deg, #000, #fff)')).toBe(0.5)
    expect(
      perceivedBackgroundBrightness('radial-gradient(circle, black, #fff, white)')
    ).toBeCloseTo(2 / 3)
  })

  it('returns null for unsupported backgrounds', () => {
    expect(
      perceivedBackgroundBrightness('linear-gradient(45deg, currentColor, transparent)')
    ).toBeNull()
    expect(perceivedBackgroundBrightness('currentColor')).toBeNull()
  })
})
