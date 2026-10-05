import { describe, expect, it } from 'vitest'
import { getJsonByteSize } from '@/lib/logs/execution/json-byte-size'

const LIMIT = 10 * 1024 * 1024

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

describe('getJsonByteSize', () => {
  it('counts a shared subtree once per occurrence, like JSON.stringify', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `row-${i}` }))
    const output = { rows }
    const executionData = {
      traceSpans: [{ output }, { output: { results: [output, output] } }],
    }
    expect(getJsonByteSize(executionData, LIMIT)).toBe(jsonBytes(executionData))
  })

  it('lets a payload whose shared subtrees exceed the limit trip it', () => {
    const big = { text: 'x'.repeat(1000) }
    const payload = Array.from({ length: 10 }, () => big)
    expect(getJsonByteSize(payload, 5000)).toBe(5001)
  })

  it.each([
    ['Dates through toJSON', { at: new Date(0), nested: [{ at: new Date(1) }] }],
    ['a toJSON that omits its member', { gone: { toJSON: () => undefined }, kept: 1 }],
    ['holes in a sparse array', { list: [1, undefined, 3, undefined, undefined] }],
    ['an omitted member before the first written one', { skipped: undefined, kept: 1 }],
    ['boxed primitives', { n: new Number(12345), s: new String('boxed'), b: new Boolean(false) }],
    ['a function with toJSON', { fn: Object.assign(() => 1, { toJSON: () => 'serialized' }) }],
    ['escapes, multi-byte text, and lone surrogates', { 'k"\\': 'a\n\u0001é漢😀\ud800' }],
  ])('matches JSON.stringify for %s', (_name, payload) => {
    expect(getJsonByteSize(payload, LIMIT)).toBe(jsonBytes(payload))
  })

  it('measures nesting deeper than a recursive walk could reach', () => {
    const depth = 50_000
    let nested: Record<string, unknown> = {}
    for (let level = 0; level < depth; level++) nested = { c: nested }
    expect(getJsonByteSize(nested, LIMIT)).toBe(depth * '{"c":}'.length + '{}'.length)
  })

  it('terminates on a cycle', () => {
    const node: Record<string, unknown> = { a: 1 }
    node.self = node
    expect(getJsonByteSize(node, LIMIT)).toBeGreaterThan(0)
  })
})
