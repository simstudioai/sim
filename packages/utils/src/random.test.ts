/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  generateRandomBytes,
  generateRandomHex,
  generateRandomString,
  randomFloat,
  randomInt,
  randomItem,
} from './random.js'

describe('random utilities', () => {
  it('returns random bytes with the requested length', () => {
    expect(generateRandomBytes(16)).toHaveLength(16)
  })

  it('chunks random byte requests over the Web Crypto per-call limit', () => {
    expect(generateRandomBytes(70_000)).toHaveLength(70_000)
  })

  it('returns lowercase hex with two chars per byte', () => {
    expect(generateRandomHex(8)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns random strings with custom alphabets', () => {
    expect(generateRandomString(12, 'abc')).toMatch(/^[abc]{12}$/)
  })

  it('returns floats in [0, 1)', () => {
    const value = randomFloat()
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
  })

  it('returns integers in [0, maxExclusive)', () => {
    const value = randomInt(10)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(10)
    expect(Number.isInteger(value)).toBe(true)
  })

  it('selects an item from an array', () => {
    expect(['a', 'b', 'c']).toContain(randomItem(['a', 'b', 'c']))
  })
})
