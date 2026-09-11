/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isOracleFusionIntegralJsonNumberToken,
  normalizeOracleFusionDecimalIdentifier,
} from '@/lib/internal/oracle-fusion/identifiers'

const OPTIONS = { maxDigits: 128 }

describe('isOracleFusionIntegralJsonNumberToken', () => {
  it.each([
    '9007199254740993',
    '-9007199254740993',
    '9007199254740993.0',
    '9.007199254740993e15',
    '1e999',
    `9007199254740993${'0'.repeat(100)}e-100`,
  ])('recognizes the exact integral token %j', (source) => {
    expect(isOracleFusionIntegralJsonNumberToken(source)).toBe(true)
  })

  it.each(['1.25', '1e-1', '1.23e1', 'not-a-number'])('rejects %j as non-integral', (source) => {
    expect(isOracleFusionIntegralJsonNumberToken(source)).toBe(false)
  })
})

describe('normalizeOracleFusionDecimalIdentifier', () => {
  it.each([
    [0, '0'],
    [42, '42'],
    ['9223372036854775807', '9223372036854775807'],
    ['9.223372036854775807e18', '9223372036854775807'],
    ['123.000', '123'],
    ['1.23e2', '123'],
    ['1000e-3', '1'],
    ['0.001e3', '1'],
    ['0e999999999999999999999999', '0'],
  ])('canonicalizes %j to %s', (value, expected) => {
    expect(normalizeOracleFusionDecimalIdentifier(value, OPTIONS)).toBe(expected)
  })

  it.each([
    -1,
    1.25,
    Number.MAX_SAFE_INTEGER + 1,
    Number.POSITIVE_INFINITY,
    '-1',
    '-0',
    '+1',
    '01',
    '1.25',
    '1e-1',
    '1e129',
    `1${'0'.repeat(128)}`,
    '1'.repeat(129),
  ])('rejects the non-canonical or out-of-range identifier %j', (value) => {
    expect(normalizeOracleFusionDecimalIdentifier(value, OPTIONS)).toBeUndefined()
  })

  it('checks configured limits before expanding exponent notation', () => {
    expect(
      normalizeOracleFusionDecimalIdentifier('1e63', { maxDigits: 64, maxSourceLength: 64 })
    ).toBe(`1${'0'.repeat(63)}`)
    expect(
      normalizeOracleFusionDecimalIdentifier('1e64', { maxDigits: 64, maxSourceLength: 64 })
    ).toBeUndefined()
    expect(() =>
      normalizeOracleFusionDecimalIdentifier('1', { maxDigits: 129, maxSourceLength: 128 })
    ).toThrow('limits are invalid')
  })

  it('checks the digit limit after removing an exact fractional suffix', () => {
    expect(
      normalizeOracleFusionDecimalIdentifier('123456000.000', {
        maxDigits: 8,
      })
    ).toBeUndefined()
  })
})
