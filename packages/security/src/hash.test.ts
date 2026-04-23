import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('is deterministic', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'))
  })

  it('returns a 64-char hex digest', () => {
    expect(sha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches the published vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('differs for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})
