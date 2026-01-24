import { describe, expect, it } from 'vitest'
import { isSafeKey, safeAssign } from '@/tools/safe-assign'

describe('isSafeKey', () => {
  it.concurrent('should return false for __proto__', () => {
    expect(isSafeKey('__proto__')).toBe(false)
  })

  it.concurrent('should return false for constructor', () => {
    expect(isSafeKey('constructor')).toBe(false)
  })

  it.concurrent('should return false for prototype', () => {
    expect(isSafeKey('prototype')).toBe(false)
  })

  it.concurrent('should return true for normal keys', () => {
    expect(isSafeKey('name')).toBe(true)
    expect(isSafeKey('email')).toBe(true)
    expect(isSafeKey('customField')).toBe(true)
    expect(isSafeKey('data')).toBe(true)
    expect(isSafeKey('__internal')).toBe(true)
  })
})

describe('safeAssign', () => {
  it.concurrent('should assign safe properties', () => {
    const target = { a: 1 }
    const source = { b: 2, c: 3 }
    const result = safeAssign(target, source)

    expect(result).toEqual({ a: 1, b: 2, c: 3 })
    expect(result).toBe(target)
  })

  it.concurrent('should filter out __proto__ key', () => {
    const target = { a: 1 }
    const source = { b: 2, __proto__: { polluted: true } } as Record<string, unknown>
    const result = safeAssign(target, source)

    expect(result).toEqual({ a: 1, b: 2 })
    expect((result as any).__proto__).toBe(Object.prototype)
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it.concurrent('should filter out constructor key', () => {
    const target = { a: 1 }
    const source = { b: 2, constructor: { prototype: { polluted: true } } }
    const result = safeAssign(target, source)

    expect(result).toEqual({ a: 1, b: 2 })
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it.concurrent('should filter out prototype key', () => {
    const target = { a: 1 }
    const source = { b: 2, prototype: { polluted: true } }
    const result = safeAssign(target, source)

    expect(result).toEqual({ a: 1, b: 2 })
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it.concurrent('should handle null source', () => {
    const target = { a: 1 }
    const result = safeAssign(target, null as any)

    expect(result).toEqual({ a: 1 })
  })

  it.concurrent('should handle undefined source', () => {
    const target = { a: 1 }
    const result = safeAssign(target, undefined as any)

    expect(result).toEqual({ a: 1 })
  })

  it.concurrent('should handle non-object source', () => {
    const target = { a: 1 }
    const result = safeAssign(target, 'string' as any)

    expect(result).toEqual({ a: 1 })
  })

  it.concurrent('should prevent prototype pollution attack', () => {
    const maliciousPayload = JSON.parse('{"__proto__": {"isAdmin": true}, "normal": "value"}')
    const target = {}
    safeAssign(target, maliciousPayload)

    const newObj = {}
    expect((newObj as any).isAdmin).toBeUndefined()
    expect((target as any).normal).toBe('value')
  })
})
