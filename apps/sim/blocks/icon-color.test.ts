/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getTileIconColorClass, isLightTileColor } from '@/blocks/icon-color'

describe('isLightTileColor', () => {
  it('treats clearly light tiles (white, Mailchimp/Infisical/Linkup) as light', () => {
    expect(isLightTileColor('#FFFFFF')).toBe(true)
    expect(isLightTileColor('#FFE01B')).toBe(true)
    expect(isLightTileColor('#F7FE62')).toBe(true)
    expect(isLightTileColor('#D6D3C7')).toBe(true)
  })

  it('keeps mid-bright saturated brand tiles (HubSpot, amber, olive) on white icons', () => {
    expect(isLightTileColor('#FF7A59')).toBe(false)
    expect(isLightTileColor('#F59E0B')).toBe(false)
    expect(isLightTileColor('#B2C147')).toBe(false)
  })

  it('treats dark tiles, gradients, and empty values as dark', () => {
    expect(isLightTileColor('#171717')).toBe(false)
    expect(isLightTileColor('#9B5CFF')).toBe(false)
    expect(isLightTileColor('linear-gradient(45deg, #fff, #000)')).toBe(false)
    expect(isLightTileColor(null)).toBe(false)
    expect(isLightTileColor(undefined)).toBe(false)
  })
})

describe('getTileIconColorClass', () => {
  it('returns a dark foreground on light tiles, white on dark tiles', () => {
    expect(getTileIconColorClass('#FFFFFF')).toBe('text-black')
    expect(getTileIconColorClass('#FFE01B')).toBe('text-black')
    expect(getTileIconColorClass('#171717')).toBe('text-white')
    expect(getTileIconColorClass('#FF7A59')).toBe('text-white')
  })

  it('emits the important variant when requested', () => {
    expect(getTileIconColorClass('#FFFFFF', true)).toBe('!text-black')
    expect(getTileIconColorClass('#171717', true)).toBe('!text-white')
  })
})
