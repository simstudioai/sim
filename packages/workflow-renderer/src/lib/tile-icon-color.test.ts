import { describe, expect, it } from 'vitest'
import { isLightTileColor } from './tile-icon-color'

describe('isLightTileColor', () => {
  it('detects light gradients that need a dark foreground', () => {
    expect(isLightTileColor('linear-gradient(180deg, #E0F7FA 0%, #FFFFFF 100%)')).toBe(true)
  })

  it('keeps a light foreground on dark and mixed gradients', () => {
    expect(isLightTileColor('linear-gradient(45deg, #4D27A8 0%, #A166FF 100%)')).toBe(false)
    expect(isLightTileColor('linear-gradient(45deg, #000, #fff)')).toBe(false)
  })
})
