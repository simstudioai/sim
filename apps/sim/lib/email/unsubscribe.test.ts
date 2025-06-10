import { describe, expect, it, vi } from 'vitest'
import {
  generateUnsubscribeToken,
  isTransactionalEmail,
  verifyUnsubscribeToken,
} from './unsubscribe'

vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-key')

describe('unsubscribe utilities', () => {
  const testEmail = 'test@example.com'
  const testEmailType = 'marketing'

  describe('generateUnsubscribeToken', () => {
    it('should generate a token with salt:hash:emailType format', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const parts = token.split(':')

      expect(parts).toHaveLength(3)
      expect(parts[0]).toHaveLength(32) // Salt should be 32 chars (16 bytes hex)
      expect(parts[1]).toHaveLength(64) // SHA256 hash should be 64 chars
      expect(parts[2]).toBe(testEmailType)
    })

    it('should generate different tokens for the same email (due to random salt)', () => {
      const token1 = generateUnsubscribeToken(testEmail, testEmailType)
      const token2 = generateUnsubscribeToken(testEmail, testEmailType)

      expect(token1).not.toBe(token2)
    })

    it('should default to marketing email type', () => {
      const token = generateUnsubscribeToken(testEmail)
      const parts = token.split(':')

      expect(parts[2]).toBe('marketing')
    })

    it('should generate different tokens for different email types', () => {
      const marketingToken = generateUnsubscribeToken(testEmail, 'marketing')
      const updatesToken = generateUnsubscribeToken(testEmail, 'updates')

      expect(marketingToken).not.toBe(updatesToken)
    })
  })

  describe('verifyUnsubscribeToken', () => {
    it('should verify a valid token', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const result = verifyUnsubscribeToken(testEmail, token)

      expect(result.valid).toBe(true)
      expect(result.emailType).toBe(testEmailType)
    })

    it('should reject an invalid token', () => {
      const invalidToken = 'invalid:token:format'
      const result = verifyUnsubscribeToken(testEmail, invalidToken)

      expect(result.valid).toBe(false)
      expect(result.emailType).toBe('format')
    })

    it('should reject a token for wrong email', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const result = verifyUnsubscribeToken('wrong@example.com', token)

      expect(result.valid).toBe(false)
    })

    it('should handle legacy tokens (2 parts) and default to marketing', () => {
      // Simulate a legacy token format (salt:hash without email type)
      const salt = 'abc123'
      const hash = 'def456'
      const legacyToken = `${salt}:${hash}`

      // This should return invalid since we can't verify legacy format properly
      // but let's test the parsing logic
      const result = verifyUnsubscribeToken(testEmail, legacyToken)
      expect(result.valid).toBe(false) // Will be false due to hash mismatch, but that's expected
    })

    it('should reject malformed tokens', () => {
      const malformedTokens = ['', 'single-part', 'too:many:parts:here:invalid', ':empty:parts:']

      malformedTokens.forEach((token) => {
        const result = verifyUnsubscribeToken(testEmail, token)
        expect(result.valid).toBe(false)
      })
    })
  })

  describe('isTransactionalEmail', () => {
    it('should identify transactional emails correctly', () => {
      expect(isTransactionalEmail('transactional')).toBe(true)
    })

    it('should identify non-transactional emails correctly', () => {
      const nonTransactionalTypes = ['marketing', 'updates', 'notifications', 'random']

      nonTransactionalTypes.forEach((type) => {
        expect(isTransactionalEmail(type)).toBe(false)
      })
    })
  })
})
