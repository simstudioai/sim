import { resetEnvMock, resetUrlsMock, setEnv, urlsMockFns } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EMAIL_HEADER_CONTROL_CHARS_REGEX,
  getFromEmailAddress,
  hasEmailHeaderControlChars,
  NO_EMAIL_HEADER_CONTROL_CHARS_REGEX,
} from './utils'

/**
 * Tests for getFromEmailAddress utility function.
 *
 * These tests verify the function correctly handles different
 * environment configurations for email addresses.
 */

beforeAll(() => {
  setEnv({
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
    EMAIL_DOMAIN: 'example.com',
  })
})

afterAll(() => {
  resetEnvMock()
  resetUrlsMock()
})

beforeEach(() => {
  urlsMockFns.mockGetEmailDomain.mockReturnValue('fallback.com')
})

describe('getFromEmailAddress', () => {
  it('should return the configured FROM_EMAIL_ADDRESS', () => {
    const result = getFromEmailAddress()
    expect(result).toBe('Sim <noreply@sim.ai>')
  })

  it('should return a valid email format', () => {
    const result = getFromEmailAddress()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should contain an @ symbol in the email', () => {
    const result = getFromEmailAddress()
    expect(result.includes('@')).toBe(true)
  })

  it('should be consistent across multiple calls', () => {
    const result1 = getFromEmailAddress()
    const result2 = getFromEmailAddress()
    expect(result1).toBe(result2)
  })
})

describe('email header safety', () => {
  it('rejects CRLF characters consistently', () => {
    const injectedHeader = 'Hello\r\nBcc: attacker@example.com'

    expect(EMAIL_HEADER_CONTROL_CHARS_REGEX.test(injectedHeader)).toBe(true)
    expect(hasEmailHeaderControlChars(injectedHeader)).toBe(true)
    expect(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX.test(injectedHeader)).toBe(false)
  })

  it('allows plain header content', () => {
    const safeHeader = 'Product feedback'

    expect(EMAIL_HEADER_CONTROL_CHARS_REGEX.test(safeHeader)).toBe(false)
    expect(hasEmailHeaderControlChars(safeHeader)).toBe(false)
    expect(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX.test(safeHeader)).toBe(true)
  })
})
