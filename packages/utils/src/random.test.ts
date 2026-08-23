/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomInt } from './random.js'

const UINT32_MAX = 0xffffffff
const UINT32_SAMPLE_SPACE_SIZE = 0x100000000

function mockRandomValues(...values: number[]) {
  let index = 0
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
    if (!(array instanceof Uint32Array)) throw new Error('Expected a Uint32Array')
    const value = values[index]
    if (value === undefined) throw new Error('Unexpected additional random draw')
    array[0] = value
    index += 1
    return array
  })
}

describe('randomInt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('terminates after one draw for a power-of-two range', () => {
    const getRandomValues = mockRandomValues(7)

    expect(randomInt(0, 16)).toBe(7)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('redraws values from the biased upper tail', () => {
    const getRandomValues = mockRandomValues(UINT32_MAX, 42)

    expect(randomInt(0, 10)).toBe(2)
    expect(getRandomValues).toHaveBeenCalledTimes(2)
  })

  it('supports a range spanning the full Uint32 sample space', () => {
    const getRandomValues = mockRandomValues(UINT32_MAX)

    expect(randomInt(0, UINT32_SAMPLE_SPACE_SIZE)).toBe(UINT32_MAX)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('rejects ranges larger than the Uint32 sample space', () => {
    expect(() => randomInt(0, UINT32_SAMPLE_SPACE_SIZE + 1)).toThrow(
      'randomInt: range must not exceed 2^32'
    )
  })
})
