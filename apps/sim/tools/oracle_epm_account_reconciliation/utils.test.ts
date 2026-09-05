/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  arcsAuthParamFields,
  optionalBoolean,
  optionalString,
  parseJson,
} from '@/tools/oracle_epm_account_reconciliation/utils'

describe('Account Reconciliation resolved-input helpers', () => {
  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    ['', undefined],
    [null, undefined],
    [undefined, undefined],
  ])('normalizes boolean %s without truthiness coercion', (input, expected) => {
    expect(optionalBoolean(input)).toBe(expected)
  })
  it.each([0, 1, 'yes', 'FALSE', {}, []])('rejects invalid boolean %s', (input) => {
    expect(() => optionalBoolean(input)).toThrow('Boolean inputs')
  })
  it('omits empty optional text without trimming repository filenames', () => {
    expect(optionalString('')).toBeUndefined()
    expect(optionalString(null)).toBeUndefined()
    expect(optionalString('inbox/Quarter 1.csv')).toBe('inbox/Quarter 1.csv')
    expect(optionalString(' name.csv ')).toBe(' name.csv ')
  })
  it('decodes JSON only after resolution and preserves already resolved arrays', () => {
    expect(parseJson('[1, 2]', 'Match IDs')).toEqual([1, 2])
    const ids = [3, 4]
    expect(parseJson(ids, 'Match IDs')).toBe(ids)
    expect(parseJson('', 'Match IDs')).toBeUndefined()
    expect(() => parseJson('<earlier.ids>', 'Match IDs')).toThrow('Match IDs must be valid JSON')
  })
  it('keeps injected destination and authorization out of model-visible inputs', () => {
    expect(arcsAuthParamFields.oauthCredential).toMatchObject({
      required: true,
      visibility: 'user-only',
    })
    expect(arcsAuthParamFields.accessToken.visibility).toBe('hidden')
    expect(arcsAuthParamFields.instanceUrl.visibility).toBe('hidden')
  })
})
