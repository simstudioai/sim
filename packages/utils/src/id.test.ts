import { describe, expect, it } from 'vitest'
import { generateId, generateShortId } from './id.js'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateId', () => {
  it('returns a valid UUID v4', () => {
    const id = generateId()
    expect(id).toMatch(UUID_V4_RE)
  })
})

describe('generateShortId', () => {
  it('throws for an alphabet shorter than 2 characters', () => {
    expect(() => generateShortId(8, 'a')).toThrow()
  })
})
