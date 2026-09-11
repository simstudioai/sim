/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import {
  type OracleFusionExactInteger,
  oracleFusionExactInteger,
  serializeOracleFusionJsonBody,
} from '@/lib/internal/oracle-fusion/request-body'

describe('oracleFusionExactInteger', () => {
  it.each([
    '0',
    '42',
    '-42',
    '9007199254740991',
    '999999999999999999',
    '-999999999999999999',
    '9'.repeat(128),
    `-${'9'.repeat(128)}`,
  ])('serializes the exact integer %s without quotes or rounding', (digits) => {
    const integer = oracleFusionExactInteger(digits)
    expect(serializeOracleFusionJsonBody(integer)).toBe(digits)
    expect(serializeOracleFusionJsonBody({ id: integer, text: digits, array: [integer] })).toBe(
      `{"id":${digits},"text":"${digits}","array":[${digits}]}`
    )
  })

  it.each([
    '',
    ' ',
    ' 1',
    '1 ',
    '1\n',
    '1\r',
    '1\r\n',
    '1\t',
    '1\u2028',
    '1\u2029',
    '1\u0000',
    '1\u007f',
    '1\uD800',
    '1😀',
    '１２',
    '+1',
    '-0',
    '00',
    '01',
    '-01',
    '-',
    '1.0',
    '1.5',
    '1e3',
    '1E+3',
    '0x10',
    'NaN',
    'Infinity',
    '1,"injected":true',
    '9'.repeat(129),
    `-${'9'.repeat(129)}`,
  ])('rejects noncanonical or excessive integer text %# with a fixed error', (digits) => {
    expect(() => oracleFusionExactInteger(digits)).toThrow(
      new Error(
        'Oracle Fusion exact integer must be a canonical decimal string of at most 128 digits'
      )
    )
  })

  it.each(
    [
      undefined,
      null,
      42,
      Number.MAX_SAFE_INTEGER + 1,
      42n,
      false,
      {},
      ['42'],
      { toString: () => '42' },
    ].map((value) => ({ value }))
  )('rejects non-string values without coercion %#', ({ value }) => {
    expect(() => oracleFusionExactInteger(value as unknown as string)).toThrow(
      new Error(
        'Oracle Fusion exact integer must be a canonical decimal string of at most 128 digits'
      )
    )
  })

  it('keeps validated digits private in a frozen in-process wrapper', () => {
    const integer = oracleFusionExactInteger('999999999999999999')
    expect(Object.isFrozen(integer)).toBe(true)
    expect(Reflect.ownKeys(integer)).toEqual([])
    expect(JSON.stringify(integer)).toBe('{}')
    expect(Reflect.set(integer, 'value', '0')).toBe(false)
    expect(serializeOracleFusionJsonBody(integer)).toBe('999999999999999999')
  })

  it('does not treat copied wrappers or lookalike objects as raw numbers', () => {
    const integer = oracleFusionExactInteger('999999999999999999')
    const lookalike = Object.freeze({
      rawJSON: '999999999999999999',
    }) as unknown as OracleFusionExactInteger
    expect(serializeOracleFusionJsonBody(lookalike)).toBe('{"rawJSON":"999999999999999999"}')
    expect(serializeOracleFusionJsonBody({ ...integer })).toBe('{}')
    expect(serializeOracleFusionJsonBody(structuredClone(integer))).toBe('{}')
    expect(() => serializeOracleFusionJsonBody(Object.create(integer))).toThrow('plain JSON data')
    expect(() => serializeOracleFusionJsonBody({ toJSON: () => integer })).toThrow(
      'plain JSON data'
    )
    expect(() =>
      serializeOracleFusionJsonBody(
        Object.defineProperty({}, 'id', {
          enumerable: true,
          get: () => integer,
        })
      )
    ).toThrow('plain JSON data')
  })

  it('counts wrappers against nesting and node budgets as scalar values', () => {
    const integer = oracleFusionExactInteger('0')
    let nested: unknown = integer
    for (let index = 0; index < 100; index += 1) nested = [nested]
    expect(serializeOracleFusionJsonBody(nested)).toBe(`${'['.repeat(100)}0${']'.repeat(100)}`)
    expect(() => serializeOracleFusionJsonBody([nested])).toThrow('nesting limit')

    expect(serializeOracleFusionJsonBody(new Array(99_999).fill(integer)).length).toBe(199_999)
    expect(() =>
      serializeOracleFusionJsonBody({ values: new Array(99_998).fill(integer), extra: integer })
    ).toThrow('complexity limit')
  })

  it('charges the full unquoted integer text to the existing byte budget', () => {
    const digits = '9'.repeat(128)
    const integer = oracleFusionExactInteger(digits)
    const padding = 'x'.repeat(MAX_INLINE_MATERIALIZATION_BYTES - digits.length - 5)
    const serialized = serializeOracleFusionJsonBody([padding, integer])
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(MAX_INLINE_MATERIALIZATION_BYTES)
    expect(serialized.endsWith(`",${digits}]`)).toBe(true)
    expect(() => serializeOracleFusionJsonBody([`${padding}x`, integer])).toThrow(
      'inline payload limit'
    )
  })
})

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

  it('serializes the descriptor values captured from a proxy exactly once', () => {
    const target = { value: 'first' }
    let descriptorReads = 0
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(current, key) {
        descriptorReads += 1
        const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
        return descriptor ? { ...descriptor, value: `read-${descriptorReads}` } : undefined
      },
    })

    expect(serializeOracleFusionJsonBody(proxy)).toBe('{"value":"read-1"}')
    expect(descriptorReads).toBe(1)

    const arrayProxy = new Proxy([1], {
      get(_current, key) {
        if (key === 'length') throw new Error('array length getter must not run')
        return undefined
      },
    })
    expect(serializeOracleFusionJsonBody(arrayProxy)).toBe('[1]')
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
