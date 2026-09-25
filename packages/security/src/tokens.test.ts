import { describe, expect, it } from 'vitest'
import { generateSecureToken } from './tokens'

describe('generateSecureToken', () => {
  it('never repeats across 1000 draws', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generateSecureToken())
    expect(seen.size).toBe(1000)
  })

  it('is URL-safe (no +, /, or = padding)', () => {
    const token = generateSecureToken(64)
    expect(token).not.toMatch(/[+/=]/)
  })
})
