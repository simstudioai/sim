/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { stringifyBoundedMemoryJson } from '@/lib/memory/bounded-json'

describe('bounded memory JSON', () => {
  it.each([
    { value: { text: 'hello', values: [1, false, null] } },
    { value: { text: 'é😀' } },
    { value: { text: '\u0000\n"\\' } },
    { value: Array.from({ length: 5000 }, () => 0) },
  ])('uses the caller byte limit including UTF-8 and escaped JSON bytes', ({ value }) => {
    const json = JSON.stringify(value)
    const bytes = Buffer.byteLength(json, 'utf8')
    expect(stringifyBoundedMemoryJson(value, bytes)).toBe(json)
    expect(stringifyBoundedMemoryJson(value, bytes - 1)).toBeUndefined()
  })

  it('rejects cycles, excessive depth, and excessive nodes', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = 'leaf'
    for (let index = 0; index < 66; index++) deep = { child: deep }
    for (const value of [cyclic, deep, Array(100_001)]) {
      expect(stringifyBoundedMemoryJson(value, 8 * 1024 * 1024)).toBeUndefined()
    }
  })

  it('does not execute accessors or custom serialization', () => {
    const getter = vi.fn(() => 'private value')
    const toJSON = vi.fn(() => 'private value')
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: getter })
    const custom = Object.defineProperty({}, 'toJSON', { value: toJSON })
    for (const value of [accessor, custom, { output: new Uint8Array([1, 2, 3]) }]) {
      expect(stringifyBoundedMemoryJson(value, 1024)).toBeUndefined()
    }
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('stops before serializing an oversized payload', () => {
    const value = { output: 'x'.repeat(1025) }
    const serialize = vi.spyOn(JSON, 'stringify')
    try {
      expect(stringifyBoundedMemoryJson(value, 1024)).toBeUndefined()
      expect(serialize).not.toHaveBeenCalled()
    } finally {
      serialize.mockRestore()
    }
  })

  it('allows repeated references without treating them as a cycle', () => {
    const result = { answer: 42 }
    const value = { rawResponse: result, modelResponse: result }
    expect(stringifyBoundedMemoryJson(value, 1024)).toBe(JSON.stringify(value))
  })
})
