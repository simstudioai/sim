import { describe, expect, it } from 'vitest'
import {
  assertOracleEpcmJsonBudget,
  parseOracleEpcmBoolean,
  parseOracleEpcmJson,
} from '@/tools/oracle_epm_enterprise_profitability/utils'

describe('Oracle EPCM resolved input helpers', () => {
  it('preserves JSON values and decimal strings', () => {
    expect(
      parseOracleEpcmJson('{"value":"1.000000000000001","missing":"#Missing"}', 'Grid')
    ).toEqual({ value: '1.000000000000001', missing: '#Missing' })
    expect(parseOracleEpcmJson({ rows: [] }, 'Grid')).toEqual({ rows: [] })
    expect(() => parseOracleEpcmJson('not json', 'Grid')).toThrow('valid JSON')
  })
  it.each([
    [undefined, undefined],
    ['', undefined],
    [null, undefined],
    ['true', true],
    ['false', false],
    [false, false],
    ['maybe', 'maybe'],
    [0, 0],
  ])('does not apply truthiness coercion', (input, expected) => {
    expect(parseOracleEpcmBoolean(input)).toBe(expected)
  })
  it('bounds strings, nested objects, and collections before materialization', () => {
    expect(() => parseOracleEpcmJson('x'.repeat(4 * 1024 * 1024 + 1), 'Grid')).toThrow('limit')
    const nested: Record<string, unknown> = {}
    nested.self = nested
    expect(() => assertOracleEpcmJsonBudget(nested, 'Grid')).toThrow('complexity')
    expect(() => assertOracleEpcmJsonBudget(Array(200_001).fill(0), 'Grid')).toThrow('complexity')
  })
})
