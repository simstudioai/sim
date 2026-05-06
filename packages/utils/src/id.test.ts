/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { generateId, generateShortId, isValidUuid } from './id.js'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateId', () => {
  it('returns a valid UUID v4', () => {
    const id = generateId()
    expect(id).toMatch(UUID_V4_RE)
  })

  it('returns unique values across 100 calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })
})

describe('generateShortId', () => {
  it('returns default length of 21', () => {
    const id = generateShortId()
    expect(id).toHaveLength(21)
  })

  it('returns custom length when specified', () => {
    const id = generateShortId(8)
    expect(id).toHaveLength(8)
  })

  it('uses only URL-safe characters', () => {
    const id = generateShortId(100)
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()))
    expect(ids.size).toBe(100)
  })

  it('supports a custom alphabet', () => {
    const alphabet = 'abcdef0123456789'
    const id = generateShortId(32, alphabet)
    expect(id).toHaveLength(32)
    expect(id).toMatch(/^[a-f0-9]+$/)
  })

  it('throws for an alphabet shorter than 2 characters', () => {
    expect(() => generateShortId(8, 'a')).toThrow()
  })
})

describe('isValidUuid', () => {
  it('returns true for valid UUIDs', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isValidUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
    expect(isValidUuid(generateId())).toBe(true)
  })

  it('returns false for invalid strings', () => {
    expect(isValidUuid('')).toBe(false)
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false)
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false)
    expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false)
  })
})
