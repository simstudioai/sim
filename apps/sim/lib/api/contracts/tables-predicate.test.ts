/**
 * The v2 query/bulk filter wire format is the typed `{ all | any: [...] }`
 * predicate tree. The contract validates structure; column-level validation
 * (unknown field, json-op) runs server-side in `validate.ts`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  deleteTableRowsBodySchema,
  predicateInputSchema,
  predicateSchema,
  rowQueryBodySchema,
  tableRowsQuerySchema,
  updateRowsByFilterBodySchema,
} from '@/lib/api/contracts/tables'
import { FILTER_OPS } from '@/lib/table/constants'
import { validatePredicate } from '@/lib/table/query-builder/validate'

/** Loose view of the generated JSON Schema, which is untyped by construction. */
type JsonSchemaNode = Record<string, JsonSchemaNode> & Record<number, JsonSchemaNode>

describe('rowQueryBodySchema', () => {
  it('accepts a root condition and normalizes it to the canonical all group', () => {
    const parsed = rowQueryBodySchema.parse({
      workspaceId: 'ws-1',
      predicate: { field: 'status', op: 'eq', value: 'active' },
    })

    expect(parsed.predicate).toEqual({
      all: [{ field: 'status', op: 'eq', value: 'active' }],
    })
  })
})

describe('bulk schemas accept either a predicate tree or the legacy filter object', () => {
  it('does not reinterpret a legacy object with field/op/value columns as a root predicate', () => {
    const filter = { field: 'status', op: 'eq', value: 'active' }
    const parsed = deleteTableRowsBodySchema.parse({ workspaceId: 'ws-1', filter })

    expect(parsed.filter).toEqual(filter)
    expect(predicateSchema.safeParse(filter).success).toBe(false)
    expect(predicateInputSchema.parse(filter)).toEqual({ all: [filter] })
  })
})

/**
 * The predicate tree is parsed by a recursive `z.lazy` union. A few thousand
 * nested groups overflow the stack inside `safeParse`, and a `RangeError`
 * escaping a parser is a 500 on a public endpoint, not a 400.
 */
describe('predicate depth / size guard', () => {
  it('rejects a deeply nested tree with a validation issue, not a RangeError', () => {
    let node: unknown = { all: [{ field: 'a', op: 'eq', value: 1 }] }
    for (let i = 0; i < 5000; i++) node = { all: [node] }

    const result = predicateSchema.safeParse(node)

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/nesting is too deep/)
  })

  it('rejects a wide-but-shallow tree past the node cap', () => {
    const node = {
      all: Array.from({ length: 60 }, () => ({
        all: Array.from({ length: 60 }, () => ({ field: 'a', op: 'eq', value: 1 })),
      })),
    }

    const result = predicateSchema.safeParse(node)

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/too many conditions/)
  })
})

/**
 * Zod strips unrecognized keys by default, so before the schemas were made
 * strict a hybrid node parsed clean against the group branch with its leaf half
 * silently deleted — turning "delete archived rows for tenant acme" into
 * "delete EVERY row for tenant acme". `validatePredicate`'s hybrid guard could
 * not catch it: the keys were gone before it ran.
 */
describe('hybrid group+leaf nodes are rejected, not silently narrowed', () => {
  const hybrid = {
    all: [{ field: 'tenant_id', op: 'eq', value: 'acme' }],
    field: 'status',
    op: 'eq',
    value: 'archived',
  }

  it('rejects rather than dropping the leaf half', () => {
    const result = predicateSchema.safeParse(hybrid)
    expect(result.success).toBe(false)
    // The dangerous outcome: parsing succeeds having quietly widened the filter.
    expect(result.success ? result.data : null).not.toEqual({ all: hybrid.all })
  })

  /**
   * The bulk schemas union the predicate tree with the legacy `$`-object, and
   * that legacy branch accepts any non-empty object — so it absorbs the hybrid
   * and the SCHEMA cannot reject it. Crucially the legacy branch does NOT strip,
   * so `all` survives, the route's `isTablePredicate` check routes it back to
   * `validatePredicate`, and the hybrid guard there rejects it (→ 400 via
   * `route.ts:325`). Asserted here so a future change to either layer that
   * removes one of them fails loudly.
   */
  it('keeps the hybrid intact through the bulk schemas so the runtime guard can see it', () => {
    for (const parsed of [
      deleteTableRowsBodySchema.safeParse({ workspaceId: 'ws-1', filter: hybrid }),
      updateRowsByFilterBodySchema.safeParse({
        workspaceId: 'ws-1',
        filter: hybrid,
        data: { active: false },
      }),
    ]) {
      expect(parsed.success).toBe(true)
      // The leaf half must NOT have been silently dropped on the way through.
      expect(parsed.success && parsed.data.filter).toMatchObject({
        all: hybrid.all,
        field: 'status',
      })
    }
  })

  it('and validatePredicate then rejects it', () => {
    expect(() =>
      validatePredicate(hybrid as never, [
        { name: 'tenant_id', type: 'string' },
        { name: 'status', type: 'string' },
      ])
    ).toThrow(/not both/)
  })

  it('rejects an unknown key on a leaf (a typo must not be dropped)', () => {
    expect(
      predicateSchema.safeParse({ all: [{ field: 'a', op: 'eq', vlaue: 'typo' }] }).success
    ).toBe(false)
  })
})

/**
 * Wire transport: requestJson serializes structured query params as JSON
 * strings; jsonQueryValue decodes them before the union runs. Without it, a
 * sorted or filtered grid request 400s at the boundary.
 */
describe('query-string JSON transport (jsonQueryValue)', () => {
  it('decodes string-encoded predicate, legacy filter, and sort spec', () => {
    const parsed = rowQueryStringSchemaProbe({
      workspaceId: 'ws-1',
      filter: JSON.stringify({ all: [{ field: 'a', op: 'eq', value: 1 }] }),
      sort: JSON.stringify([{ field: 'a', direction: 'asc' }]),
    })
    expect(parsed.filter).toEqual({ all: [{ field: 'a', op: 'eq', value: 1 }] })
    expect(parsed.sort).toEqual([{ field: 'a', direction: 'asc' }])

    const legacy = rowQueryStringSchemaProbe({
      workspaceId: 'ws-1',
      filter: JSON.stringify({ status: { $eq: 'x' } }),
      sort: JSON.stringify({ status: 'desc' }),
    })
    expect(legacy.filter).toEqual({ status: { $eq: 'x' } })
    expect(legacy.sort).toEqual({ status: 'desc' })
  })
})

function rowQueryStringSchemaProbe(input: Record<string, unknown>) {
  const result = tableRowsQuerySchema.safeParse(input)
  if (!result.success) throw new Error(JSON.stringify(result.error.issues[0]))
  return result.data
}

/**
 * The predicate is a `pipe` over `z.unknown()`, so `z.toJSONSchema` documents
 * it from an input side that carries no shape: the leaf keys `field`, `op`, and
 * `value` were named nowhere in the published contract and were discoverable
 * only by reading an example. The shape is now supplied through `.meta()`,
 * which means it is hand-written beside a runtime schema that can move without
 * it. These assertions are the join.
 */
describe('the published predicate schema', () => {
  const published = z.toJSONSchema(predicateSchema, { io: 'input', unrepresentable: 'any' })
  const leaf = (published.oneOf as JsonSchemaNode[])[0].properties.all.items.anyOf[1]

  it('names the leaf keys the server actually requires', () => {
    expect(Object.keys(leaf.properties)).toEqual(['field', 'op', 'value'])
    expect(leaf.required).toEqual(['field', 'op'])
    expect(leaf.additionalProperties).toBe(false)
  })

  it('publishes exactly the operators the server accepts', () => {
    expect(leaf.properties.op.enum).toEqual([...FILTER_OPS])
  })
})
