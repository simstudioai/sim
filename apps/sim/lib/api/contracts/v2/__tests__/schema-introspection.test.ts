/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  issueCodes,
  rejectsUnknownKeys,
  type SchemaLike,
  strictnessTargets,
} from '@/lib/api/contracts/v2/__tests__/schema-introspection'

const strictObject = z.object({ a: z.string() }).strict()
const looseObject = z.object({ a: z.string() })

describe('strictnessTargets', () => {
  it('returns a plain object schema unchanged', () => {
    expect(strictnessTargets(strictObject as unknown as SchemaLike)).toHaveLength(1)
  })

  it('expands a union into its members', () => {
    expect(
      strictnessTargets(z.union([strictObject, looseObject]) as unknown as SchemaLike)
    ).toHaveLength(2)
  })

  it('unwraps a wrapper around a union, which the tables walker could not', () => {
    expect(
      strictnessTargets(z.union([strictObject, looseObject]).optional() as unknown as SchemaLike)
    ).toHaveLength(2)
  })
})

describe('rejectsUnknownKeys', () => {
  it('reads a strict object as strict', () => {
    expect(rejectsUnknownKeys(strictObject)).toBe(true)
  })

  it('reads a Zod 4 refined strict object as strict, because refine is a check and not a wrapper', () => {
    expect(rejectsUnknownKeys(strictObject.refine(() => true))).toBe(true)
  })

  it('reads a non-strict object as non-strict', () => {
    expect(rejectsUnknownKeys(looseObject)).toBe(false)
  })

  it('unwraps wrappers', () => {
    expect(rejectsUnknownKeys(strictObject.optional())).toBe(true)
    expect(rejectsUnknownKeys(looseObject.optional())).toBe(false)
  })

  /**
   * The hole the pagination sweep used to carry: a union answered `null`, and a
   * `null` verdict was skipped, so a union-shaped query opted out of the
   * strictness sweep entirely. A union is only as strict as its weakest member.
   */
  it('rejects a union whose members are not all strict, rather than answering null', () => {
    expect(rejectsUnknownKeys(z.union([strictObject, looseObject]))).toBe(false)
    expect(rejectsUnknownKeys(z.union([strictObject, strictObject]))).toBe(true)
    expect(rejectsUnknownKeys(z.union([strictObject, looseObject]).optional())).toBe(false)
  })

  it('answers null for a schema it cannot introspect, so the sweep fails loudly', () => {
    expect(rejectsUnknownKeys(z.string())).toBeNull()
    expect(rejectsUnknownKeys(undefined)).toBeNull()
  })
})

describe('issueCodes', () => {
  it('flattens the member failures nested under a union issue', () => {
    const result = z.union([strictObject, strictObject]).safeParse({ a: 'x', unknown: 1 })
    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })
})
