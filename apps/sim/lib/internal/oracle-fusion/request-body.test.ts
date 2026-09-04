/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'

describe('serializeOracleFusionJsonBody', () => {
  it('serializes plain objects, arrays, null-prototype objects, and JSON scalars', () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.value = 'ok'

    expect(
      serializeOracleFusionJsonBody({
        string: 'value',
        number: 12.5,
        boolean: false,
        nil: null,
        array: [1, 'two'],
        nullPrototype,
      })
    ).toBe(
      '{"string":"value","number":12.5,"boolean":false,"nil":null,"array":[1,"two"],"nullPrototype":{"value":"ok"}}'
    )
  })

  it.each([
    undefined,
    () => undefined,
    Symbol('value'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
  ])('rejects unsupported root values %#', (value) => {
    expect(() => serializeOracleFusionJsonBody(value)).toThrow('plain JSON data')
  })

  it('rejects unsupported nested values instead of applying JSON omission rules', () => {
    expect(() => serializeOracleFusionJsonBody({ missing: undefined })).toThrow('plain JSON data')
    expect(() => serializeOracleFusionJsonBody([undefined])).toThrow('plain JSON data')
    expect(() => serializeOracleFusionJsonBody(new Array(1))).toThrow('plain JSON data')
  })

  it('rejects custom serialization, accessors, symbols, and array properties', () => {
    expect(() => serializeOracleFusionJsonBody({ toJSON: () => ({}) })).toThrow('plain JSON data')

    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'secret',
    })
    expect(() => serializeOracleFusionJsonBody(accessor)).toThrow('plain JSON data')

    expect(() => serializeOracleFusionJsonBody({ [Symbol('secret')]: 'value' })).toThrow(
      'plain JSON data'
    )

    const array = [1]
    Object.defineProperty(array, 'extra', { value: true, enumerable: true })
    expect(() => serializeOracleFusionJsonBody(array)).toThrow('plain JSON data')

    const customArray = [1]
    Object.setPrototypeOf(customArray, null)
    expect(() => serializeOracleFusionJsonBody(customArray)).toThrow('plain JSON data')
  })

  it('rejects inherited custom serialization before JSON.stringify can invoke it', () => {
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
    Object.defineProperty(Array.prototype, 'toJSON', {
      configurable: true,
      value: () => ({ replaced: true }),
    })
    try {
      expect(() => serializeOracleFusionJsonBody([1])).toThrow('plain JSON data')
    } finally {
      if (previous) Object.defineProperty(Array.prototype, 'toJSON', previous)
      else Reflect.deleteProperty(Array.prototype, 'toJSON')
    }
  })

  it('rejects cycles, excessive nesting, and excessive complexity', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => serializeOracleFusionJsonBody(cycle)).toThrow('must not be cyclic')

    let nested: unknown = null
    for (let index = 0; index < 101; index += 1) nested = [nested]
    expect(() => serializeOracleFusionJsonBody(nested)).toThrow('nesting limit')

    expect(() => serializeOracleFusionJsonBody(new Array(100_001).fill(null))).toThrow(
      'complexity limit'
    )
  })

  it('rejects UTF-8 output beyond the inline materialization limit', () => {
    expect(() =>
      serializeOracleFusionJsonBody('x'.repeat(MAX_INLINE_MATERIALIZATION_BYTES))
    ).toThrow('inline payload limit')
  })
})
