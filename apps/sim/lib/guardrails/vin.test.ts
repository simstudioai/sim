/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findVins, isValidVin, maskVins } from '@/lib/guardrails/vin'

const VALID = '1HGCM82633A004352' // check digit (position 9) = 3
const INVALID_CHECK = '1HGCM82643A004352' // same shape, wrong check digit

describe('isValidVin', () => {
  it('accepts a VIN with a correct ISO 3779 check digit', () => {
    expect(isValidVin(VALID)).toBe(true)
  })

  it('rejects a 17-char code whose check digit does not validate', () => {
    expect(isValidVin(INVALID_CHECK)).toBe(false)
  })

  it('rejects wrong length', () => {
    expect(isValidVin('1HGCM82633A00435')).toBe(false)
    expect(isValidVin(`${VALID}9`)).toBe(false)
  })

  it('rejects disallowed letters I/O/Q', () => {
    expect(isValidVin('1HGCM82633A0043I2'.slice(0, 17))).toBe(false)
  })
})

describe('findVins', () => {
  it('returns spans only for valid VINs, in order', () => {
    const text = `vin ${VALID} and bogus ${INVALID_CHECK} done`
    const spans = findVins(text)
    expect(spans).toHaveLength(1)
    expect(text.slice(spans[0].start, spans[0].end)).toBe(VALID)
  })

  it('finds multiple valid VINs', () => {
    const text = `${VALID} ${VALID}`
    expect(findVins(text)).toHaveLength(2)
  })
})

describe('maskVins', () => {
  it('replaces valid VINs with <VIN> and leaves invalid candidates untouched', () => {
    expect(maskVins(`car ${VALID}`)).toBe('car <VIN>')
    expect(maskVins(`code ${INVALID_CHECK}`)).toBe(`code ${INVALID_CHECK}`)
  })

  it('returns text unchanged when there is no VIN', () => {
    expect(maskVins('no vehicle here')).toBe('no vehicle here')
  })
})
