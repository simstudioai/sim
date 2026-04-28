import { describe, expect, it } from 'vitest'
import { generateSecureToken } from './tokens'

describe('generateSecureToken', () => {
  it('defaults to 24 bytes (32-char base64url)', () => {
    const token = generateSecureToken()
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('honors a custom byte length', () => {
    const token = generateSecureToken(16)
    expect(token).toHaveLength(22)
  })

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
