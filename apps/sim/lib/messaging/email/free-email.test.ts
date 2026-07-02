/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isFreeEmailDomain } from './free-email'

describe('isFreeEmailDomain', () => {
  it('returns true for known free/personal providers', () => {
    expect(isFreeEmailDomain('jane@gmail.com')).toBe(true)
    expect(isFreeEmailDomain('jane@yahoo.com')).toBe(true)
    expect(isFreeEmailDomain('jane@hotmail.com')).toBe(true)
  })

  it('returns false for work domains', () => {
    expect(isFreeEmailDomain('jane@acme.co')).toBe(false)
    expect(isFreeEmailDomain('jane@sim.ai')).toBe(false)
  })

  it('is case-insensitive on the domain', () => {
    expect(isFreeEmailDomain('Jane@GMAIL.com')).toBe(true)
  })

  it('returns false when there is no domain', () => {
    expect(isFreeEmailDomain('jane')).toBe(false)
    expect(isFreeEmailDomain('')).toBe(false)
  })
})
