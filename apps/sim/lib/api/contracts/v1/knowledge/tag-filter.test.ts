import { describe, expect, it } from 'vitest'
import { v1SearchTagFilterSchema } from '@/lib/api/contracts/v1/knowledge'

/**
 * v1 is a shipped public API, so this schema stays lenient about keys it does
 * not declare — that is deliberate, not an oversight, and the v2 element layers
 * `.strict()` on top of it instead. What v1 does share with v2 is the operator
 * enum and the `between` rule: an unrecognized operator used to reach the search
 * query builder and be coerced to equality, silently answering a different
 * question than the caller asked.
 */
describe('v1 knowledge search tag filter', () => {
  it('still strips an unrecognized key rather than rejecting the request', () => {
    const parsed = v1SearchTagFilterSchema.safeParse({
      tagName: 'category',
      operator: 'eq',
      value: 'billing',
      unknownKey: 'ignored',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ tagName: 'category', operator: 'eq', value: 'billing' })
  })

  it('rejects an operator no field type implements', () => {
    expect(
      v1SearchTagFilterSchema.safeParse({
        tagName: 'category',
        operator: 'nosuchop',
        value: 'billing',
      }).success
    ).toBe(false)
  })

  it('rejects "between" with no valueTo, including the mis-cased key that strips to it', () => {
    expect(
      v1SearchTagFilterSchema.safeParse({ tagName: 'score', operator: 'between', value: 1 }).success
    ).toBe(false)
    expect(
      v1SearchTagFilterSchema.safeParse({
        tagName: 'score',
        operator: 'between',
        value: 1,
        valueto: 5,
      }).success
    ).toBe(false)
  })

  it('accepts a bounded between filter and defaults a missing operator to eq', () => {
    expect(
      v1SearchTagFilterSchema.safeParse({
        tagName: 'score',
        operator: 'between',
        value: 1,
        valueTo: 5,
      }).success
    ).toBe(true)
    expect(
      v1SearchTagFilterSchema.safeParse({ tagName: 'category', value: 'billing' }).data
    ).toEqual({ tagName: 'category', operator: 'eq', value: 'billing' })
  })
})
