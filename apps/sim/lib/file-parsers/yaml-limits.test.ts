/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createYamlExpansionBudget,
  isYamlExpansionBudgetExhausted,
  measureYamlExpansion,
  type YamlExpansionLimits,
} from '@/lib/file-parsers/yaml-limits'

const LIMITS: YamlExpansionLimits = {
  maxNodes: 1000,
  maxSerializedBytes: 64 * 1024,
  maxDepth: 10,
}

const limits = (overrides: Partial<YamlExpansionLimits> = {}): YamlExpansionLimits => ({
  ...LIMITS,
  ...overrides,
})

describe('measureYamlExpansion', () => {
  it('reports the depth of the expanded tree', () => {
    expect(measureYamlExpansion('scalar', LIMITS)).toEqual({ within: true, depth: 0 })
    expect(measureYamlExpansion([1, 2, 3], LIMITS)).toEqual({ within: true, depth: 1 })
    expect(measureYamlExpansion({ a: { b: { c: 1 } } }, LIMITS)).toEqual({ within: true, depth: 3 })
  })

  it('counts an empty container as a level', () => {
    expect(measureYamlExpansion([], LIMITS)).toEqual({ within: true, depth: 1 })
    expect(measureYamlExpansion({ a: {} }, LIMITS)).toEqual({ within: true, depth: 2 })
  })

  it('charges an aliased subtree once per path that reaches it', () => {
    const shared = [1, 2, 3, 4, 5]
    const aliased = { a: shared, b: shared, c: shared }

    const measured = measureYamlExpansion(aliased, limits({ maxNodes: 20 }))
    expect(measured).toEqual({ within: true, depth: 2 })
    // 18 nodes if every reach is charged; 8 if the shared array were counted once.
    expect(measureYamlExpansion(aliased, limits({ maxNodes: 12 })).within).toBe(false)
  })

  it('terminates on a self-referential anchor instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const measured = measureYamlExpansion(cyclic, LIMITS)

    expect(measured.within).toBe(false)
    if (!measured.within) expect(measured.reason).toContain('nesting depth')
  })

  it('rejects a wide fan-out of containers without enumerating it first', () => {
    // The traversal holds one frame per level, not one per pending node, so a node
    // whose fan-out dwarfs the budget trips the cap part way through rather than
    // after building a frame for every sibling.
    const wide = Array.from({ length: 100_000 }, () => ({ a: 1 }))

    const measured = measureYamlExpansion(wide, limits({ maxNodes: 50 }))

    expect(measured.within).toBe(false)
    if (!measured.within) expect(measured.reason).toContain('expanded nodes')
  })

  it('charges a long number its serialized length, not the flat allowance', () => {
    // Each serializes to 24 characters; the flat non-string allowance is 16.
    const longNumbers = Array.from({ length: 200 }, () => -1.2345678901234567e-308)
    const shortNumbers = Array.from({ length: 200 }, () => 1)

    // Sits between what 200 short numbers cost (~4.4 KB) and what 200 long ones do
    // (~6 KB); under the flat allowance both would land on the same side of it.
    const byteCap = limits({ maxSerializedBytes: 5000 })

    expect(measureYamlExpansion(shortNumbers, byteCap).within).toBe(true)
    expect(measureYamlExpansion(longNumbers, byteCap).within).toBe(false)
  })

  it('charges object keys, so an aliased object with long keys cannot bypass the cap', () => {
    const key = 'k'.repeat(500)
    const shared = { [key]: 1 }
    const aliased = Array.from({ length: 50 }, () => shared)

    const measured = measureYamlExpansion(aliased, limits({ maxSerializedBytes: 10_000 }))

    expect(measured.within).toBe(false)
    if (!measured.within) expect(measured.reason).toContain('serialized size')
  })

  it('draws several documents down one shared budget', () => {
    const budget = createYamlExpansionBudget(limits({ maxNodes: 30 }))
    const doc = Array.from({ length: 10 }, (_, i) => i)

    expect(measureYamlExpansion(doc, limits({ maxNodes: 30 }), budget).within).toBe(true)
    expect(isYamlExpansionBudgetExhausted(budget)).toBe(false)
    expect(measureYamlExpansion(doc, limits({ maxNodes: 30 }), budget).within).toBe(true)
    // The third pass runs out: 3 x 11 nodes exceeds the 30 the budget was created with.
    expect(measureYamlExpansion(doc, limits({ maxNodes: 30 }), budget).within).toBe(false)
    expect(isYamlExpansionBudgetExhausted(budget)).toBe(true)
  })

  it('leaves a shared budget usable after a depth rejection', () => {
    // Depth costs only its own nesting, so one over-deep document must not bankrupt
    // the documents that share its budget.
    const budget = createYamlExpansionBudget(limits({ maxDepth: 2 }))
    const deep = { a: { b: { c: { d: 1 } } } }

    expect(measureYamlExpansion(deep, limits({ maxDepth: 2 }), budget).within).toBe(false)
    expect(isYamlExpansionBudgetExhausted(budget)).toBe(false)
    expect(measureYamlExpansion({ ok: 1 }, limits({ maxDepth: 2 }), budget).within).toBe(true)
  })

  it('ignores inherited properties when walking an object', () => {
    const parent = { inherited: 'x'.repeat(5000) }
    const child = Object.create(parent) as Record<string, unknown>
    child.own = 1

    const measured = measureYamlExpansion(child, limits({ maxSerializedBytes: 200 }))

    expect(measured).toEqual({ within: true, depth: 1 })
  })
})
