/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getContrastTextColor, isDarkColor, isLightColor } from '@/lib/colors/brightness'

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
