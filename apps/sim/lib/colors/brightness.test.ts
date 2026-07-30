/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getContrastTextColor,
  isDarkColor,
  isLightColor,
  perceivedBrightness,
} from '@/lib/colors/brightness'

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

describe('isLightColor', () => {
  it('classifies light vs dark tiles at the default threshold', () => {
    expect(isLightColor('#FFFFFF')).toBe(true)
    expect(isLightColor('#FFE01B')).toBe(true)
    expect(isLightColor('#EAB308')).toBe(true)
    expect(isLightColor('#171717')).toBe(false)
    expect(isLightColor('#3B82F6')).toBe(false)
  })

  it('treats non-color values (gradients) as dark', () => {
    expect(isLightColor('linear-gradient(45deg, #fff, #000)')).toBe(false)
    expect(isLightColor('currentColor')).toBe(false)
  })

  it('respects a custom threshold', () => {
    expect(isLightColor('#808080', 0.9)).toBe(false)
  })
})

describe('isDarkColor', () => {
  it('classifies dark vs light at the 0.5 midpoint', () => {
    expect(isDarkColor('#000000')).toBe(true)
    expect(isDarkColor('#3B82F6')).toBe(true)
    expect(isDarkColor('#ffffff')).toBe(false)
    expect(isDarkColor('#FFE01B')).toBe(false)
  })

  it('treats unparseable values as not dark', () => {
    expect(isDarkColor('currentColor')).toBe(false)
  })
})

describe('getContrastTextColor', () => {
  it('picks black on light colors and white on dark colors', () => {
    expect(getContrastTextColor('#ffffff')).toBe('#000000')
    expect(getContrastTextColor('#FFE01B')).toBe('#000000')
    expect(getContrastTextColor('#000000')).toBe('#ffffff')
    expect(getContrastTextColor('#3B82F6')).toBe('#ffffff')
  })

  it('treats unparseable colors as light (black text), matching legacy behavior', () => {
    expect(getContrastTextColor('currentColor')).toBe('#000000')
  })
})
