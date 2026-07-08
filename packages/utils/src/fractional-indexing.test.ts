/**
 * @vitest-environment node
 *
 * Locks in the BYTEWISE ordering the rest of the stack depends on: `order_key` is
 * stored `COLLATE "C"` (migration 0228) so Postgres compares keys the same way this
 * library does. If the library's order ever diverged from ASCII byte order — e.g.
 * across the `Z` (0x5A) < `a` (0x61) integer-head boundary, exactly where the
 * `en_US.UTF-8` locale disagrees — inserts would mint keys that fail the `a >= b`
 * assertion and rows would display out of order. These tests would catch that.
 */
import { describe, expect, it } from 'vitest'
import { BASE_62_DIGITS, generateKeyBetween, generateNKeysBetween } from './fractional-indexing'

/** Bytewise (ASCII / UTF-16 code-unit) comparator — what `COLLATE "C"` and the library use. */
const byteCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

describe('fractional-indexing bytewise ordering', () => {
  it('uses an alphabet in ascending char-code order with uppercase before lowercase', () => {
    for (let i = 1; i < BASE_62_DIGITS.length; i++) {
      expect(BASE_62_DIGITS.charCodeAt(i)).toBeGreaterThan(BASE_62_DIGITS.charCodeAt(i - 1))
    }
    // The boundary en_US.UTF-8 inverts: bytewise 'Z' < 'a', locale 'a' < 'Z'.
    expect('Z' < 'a').toBe(true)
    expect(BASE_62_DIGITS.indexOf('Z')).toBeLessThan(BASE_62_DIGITS.indexOf('a'))
  })

  it('produces strictly bytewise-increasing keys on repeated append', () => {
    let prev: string | null = null
    let last = ''
    for (let i = 0; i < 200; i++) {
      const key: string = generateKeyBetween(prev, null)
      if (last) expect(byteCompare(last, key)).toBe(-1)
      last = key
      prev = key
    }
  })

  it('stays bytewise-ordered when prepends cross the Z/a integer-head boundary', () => {
    // Repeated prepend walks the integer head down out of 'a' into 'Z','Y',… —
    // the exact uppercase region en_US.UTF-8 sorts wrong. The first prepend before
    // "a0" already yields a 'Z'-headed key ("Zz").
    const keys: string[] = []
    let next: string | null = null
    for (let i = 0; i < 60; i++) {
      const key: string = generateKeyBetween(null, next)
      keys.push(key)
      next = key
    }
    const ascending = [...keys].reverse() // prepends are emitted largest → smallest
    expect([...ascending].sort(byteCompare)).toEqual(ascending)
    expect(new Set(keys).size).toBe(keys.length) // all distinct
    // An uppercase-headed key sorts before the lowercase-headed "a0" at the tail.
    expect(ascending.some((k) => k[0] >= 'A' && k[0] <= 'Z')).toBe(true)
    expect(ascending[ascending.length - 1][0]).toBe('a')
  })

  it('mints a contiguous run that is bytewise-sorted and distinct', () => {
    const keys = generateNKeysBetween(null, null, 500)
    expect([...keys].sort(byteCompare)).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('throws when bounds are out of order — the contract COLLATE "C" must satisfy', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow()
    expect(() => generateKeyBetween('a0', 'a0')).toThrow()
  })
})
