import { describe, expect, it, vi } from 'vitest'
import { stringifyBoundedJson } from '@/lib/core/utils/bounded-json'

describe('bounded JSON', () => {
  it.each([
    { value: { text: 'hello', values: [1, false, null] } },
    { value: { text: 'é😀\ud800\udc00\ud800' } },
    { value: { absent: undefined, values: [undefined, Number.NaN] } },
    { value: { text: '\u0000\n"\\' } },
    { value: Array.from({ length: 5000 }, () => 0) },
  ])('uses the caller byte limit including UTF-8 and escaped JSON bytes', ({ value }) => {
    const json = JSON.stringify(value)
    const bytes = Buffer.byteLength(json, 'utf8')
    expect(stringifyBoundedJson(value, bytes)).toBe(json)
    expect(stringifyBoundedJson(value, bytes - 1)).toBeUndefined()
  })

  it('rejects cycles, excessive depth, and excessive nodes', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = 'leaf'
    for (let index = 0; index < 66; index++) deep = { child: deep }
    for (const value of [
      cyclic,
      deep,
      Array(100_001),
      Object.fromEntries(Array.from({ length: 100_001 }, (_, index) => [index, undefined])),
    ]) {
      expect(stringifyBoundedJson(value, 8 * 1024 * 1024)).toBeUndefined()
    }
  })

  it('does not execute accessors or custom serialization', () => {
    const getter = vi.fn(() => 'private value')
    const toJSON = vi.fn(() => 'private value')
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: getter })
    const custom = Object.defineProperty({}, 'toJSON', { value: toJSON })
    for (const value of [accessor, custom, { output: new Uint8Array([1, 2, 3]) }]) {
      expect(stringifyBoundedJson(value, 1024)).toBeUndefined()
    }
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('stops before serializing an oversized payload', () => {
    const value = { output: 'x'.repeat(1025) }
    const serialize = vi.spyOn(JSON, 'stringify')
    try {
      expect(stringifyBoundedJson(value, 1024)).toBeUndefined()
      expect(serialize).not.toHaveBeenCalled()
    } finally {
      serialize.mockRestore()
    }
  })

  it.each([
    { value: { text: '\u0000'.repeat(200) } },
    { value: { ['\u0000'.repeat(200)]: 'value' } },
    { value: { text: '\ud800'.repeat(200) } },
  ])('rejects escaped bytes before serializing the captured graph', ({ value }) => {
    const serialize = vi.spyOn(JSON, 'stringify')
    try {
      expect(stringifyBoundedJson(value, 1024)).toBeUndefined()
      expect(serialize).not.toHaveBeenCalled()
    } finally {
      serialize.mockRestore()
    }
  })

  it('serializes the admitted descriptors without reading proxy values or toJSON', () => {
    const get = vi.fn(() => 'UNADMITTED')
    const value = new Proxy({ text: 'admitted' }, { get })
    expect(stringifyBoundedJson(value, 1024)).toBe('{"text":"admitted"}')
    expect(get).not.toHaveBeenCalled()
  })

  it('does not read inherited numeric accessors in sparse arrays', () => {
    const get = vi.fn(() => 'UNADMITTED')
    const prototype = Object.create(Array.prototype, { 0: { get } })
    const value = Object.setPrototypeOf(Array(1), prototype)
    expect(stringifyBoundedJson(value, 1024)).toBe('[null]')
    expect(get).not.toHaveBeenCalled()
  })

  it('allows repeated references without treating them as a cycle', () => {
    const result = { answer: 42 }
    const value = { rawResponse: result, modelResponse: result }
    expect(stringifyBoundedJson(value, 1024)).toBe(JSON.stringify(value))
  })
})
