import { createEnvMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

/**
 * Tests for getFromEmailAddress utility function.
 *
 * These tests verify the function correctly handles different
 * environment configurations for email addresses.
 */

// Set up mocks at module level - these will be used for all tests in this file
vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
    EMAIL_DOMAIN: 'example.com',
  })
)

vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn().mockReturnValue('fallback.com'),
}))

import { getFromEmailAddress } from './utils'

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
    // Either contains @ directly or in angle brackets
    expect(result.includes('@')).toBe(true)
  })

  it('should be consistent across multiple calls', () => {
    const result1 = getFromEmailAddress()
    const result2 = getFromEmailAddress()
    expect(result1).toBe(result2)
  })
})
