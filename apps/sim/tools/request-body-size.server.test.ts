/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { stringifyRequestWithinLimit } from '@/tools/request-body-size.server'

describe('stringifyRequestWithinLimit', () => {
  it.each([
    { 'escaped"key\n': '\u0000é😀\ud800', empty: {}, array: [1, null, true] },
    { missing: undefined, array: [undefined, () => 1, Symbol('omitted'), Number.NaN] },
    { date: new Date('2026-01-01T00:00:00Z'), boxed: [Object(1), Object('é'), Object(false)] },
  ])('preserves native JSON and its exact UTF-8 limit for %j', (value) => {
    const expected = JSON.stringify(value)
    const bytes = Buffer.byteLength(expected, 'utf8')
    expect(stringifyRequestWithinLimit(value, bytes)).toBe(expected)
    expect(() => stringifyRequestWithinLimit(value, bytes - 1)).toThrow(PayloadSizeLimitError)
  })

  it('invokes getters, toJSON and boxed conversions only once', () => {
    const getter = vi.fn(() => ({ toJSON }))
    const toJSON = vi.fn(() => 'value')
    const numberConversion = vi.fn(() => 3)
    const stringConversion = vi.fn(() => 'text')
    const value = {
      get data() {
        return getter()
      },
      number: Object.assign(Object(1), { [Symbol.toPrimitive]: numberConversion }),
      string: Object.assign(Object('original'), { [Symbol.toPrimitive]: stringConversion }),
    }

    expect(stringifyRequestWithinLimit(value, 100)).toBe(
      '{"data":"value","number":3,"string":"text"}'
    )
    for (const hook of [getter, toJSON, numberConversion, stringConversion]) {
      expect(hook).toHaveBeenCalledTimes(1)
    }
  })

  it('stops native traversal before later getters on oversized strings', () => {
    const later = vi.fn()
    const value = {
      large: '\u0000'.repeat(100),
      get later() {
        return later()
      },
    }

    expect(() => stringifyRequestWithinLimit(value, 50)).toThrow(PayloadSizeLimitError)
    expect(later).not.toHaveBeenCalled()
  })

  it('preserves native omissions, shared objects, cycle errors and bigint conversion errors', () => {
    const shared = { a: 1 }
    expect(stringifyRequestWithinLimit([shared, shared], 100)).toBe(
      JSON.stringify([shared, shared])
    )
    expect(stringifyRequestWithinLimit(undefined, 100)).toBeUndefined()
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(() => stringifyRequestWithinLimit(cycle, 100)).toThrow(TypeError)
    const number = Object.assign(Object(1), { [Symbol.toPrimitive]: () => 1n })
    expect(() => JSON.stringify(number)).toThrow(TypeError)
    expect(() => stringifyRequestWithinLimit(number, 100)).toThrow(TypeError)
    expect(() => stringifyRequestWithinLimit(1n, 100)).toThrow(TypeError)
  })
})
