import { describe, expect, it } from 'vitest'
import { stableStringify } from './hash'

describe('stableStringify', () => {
  it('serializes objects the same whatever their key order, at every depth', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }
    expect(stableStringify(a)).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}')
    expect(stableStringify(b)).toBe(stableStringify(a))
  })

  it('orders keys by code unit, not by locale', () => {
    expect(stableStringify({ b: 1, B: 2, a: 3, _: 4 })).toBe('{"B":2,"_":4,"a":3,"b":1}')
  })

  it('keeps array order and drops undefined object fields', () => {
    expect(stableStringify({ list: [3, 1, 2], gone: undefined })).toBe('{"list":[3,1,2]}')
  })

  it('escapes lone surrogates so distinct strings never collide', () => {
    expect(stableStringify('\uD800')).not.toBe(stableStringify('\uD801'))
    expect(stableStringify('\uD800')).toBe('"\\ud800"')
  })

  it('rejects values JSON cannot represent instead of guessing', () => {
    expect(() => stableStringify({ n: Number.NaN })).toThrow(TypeError)
    expect(() => stableStringify([Number.POSITIVE_INFINITY])).toThrow(TypeError)
    expect(() => stableStringify([undefined])).toThrow(TypeError)
    // A hole is `undefined` too; skipping it would hash `[,]` as `[]`.
    const trailingHole = [1]
    trailingHole.length = 2
    expect(() => stableStringify(new Array(1))).toThrow(TypeError)
    expect(() => stableStringify(trailingHole)).toThrow(TypeError)
    expect(() => stableStringify({ f: () => 1 })).toThrow(TypeError)
    expect(() => stableStringify(BigInt(1))).toThrow(TypeError)
    expect(() => stableStringify(new Date(0))).toThrow(TypeError)
  })

  it('rejects cycles but allows a shared object reached twice', () => {
    const shared = { x: 1 }
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => stableStringify(cyclic)).toThrow(TypeError)
  })
})
