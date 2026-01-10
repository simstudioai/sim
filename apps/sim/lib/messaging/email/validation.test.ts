import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { quickValidateEmail, validateEmail } from '@/lib/messaging/email/validation'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('dns', () => ({
  resolveMx: (
    _domain: string,
    callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
  ) => {
    callback(null, [{ exchange: 'mail.example.com', priority: 10 }])
  },
}))

describe('Email Validation', () => {
  describe('validateEmail', () => {
    it.concurrent('should validate a correct email', async () => {
      const result = await validateEmail('user@example.com')
      expect(result.isValid).toBe(true)
      expect(result.checks.syntax).toBe(true)
      expect(result.checks.disposable).toBe(true)
    })

    it.concurrent('should reject invalid syntax', async () => {
      const result = await validateEmail('invalid-email')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
      expect(result.checks.syntax).toBe(false)
    })

    it.concurrent('should reject disposable email addresses', async () => {
      const result = await validateEmail('test@10minutemail.com')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Disposable email addresses are not allowed')
      expect(result.checks.disposable).toBe(false)
    })

    it.concurrent('should reject consecutive dots (RFC violation)', async () => {
      const result = await validateEmail('user..name@example.com')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Email contains suspicious patterns')
    })

    it.concurrent('should reject very long local parts (RFC violation)', async () => {
      const longLocalPart = 'a'.repeat(65)
      const result = await validateEmail(`${longLocalPart}@example.com`)
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Email contains suspicious patterns')
    })

    it.concurrent('should reject email with missing domain', async () => {
      const result = await validateEmail('user@')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should reject email with domain starting with dot', async () => {
      const result = await validateEmail('user@.example.com')
      expect(result.isValid).toBe(false)
      // The regex catches this as a syntax error before domain validation
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should reject email with domain ending with dot', async () => {
      const result = await validateEmail('user@example.')
      expect(result.isValid).toBe(false)
      // The regex catches this as a syntax error before domain validation
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should reject email with domain missing TLD', async () => {
      const result = await validateEmail('user@localhost')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid domain format')
    })

    it.concurrent('should reject email longer than 254 characters', async () => {
      const longLocal = 'a'.repeat(64)
      const longDomain = `${'b'.repeat(180)}.com`
      const result = await validateEmail(`${longLocal}@${longDomain}`)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should validate various known disposable email domains', async () => {
      const disposableDomains = [
        'mailinator.com',
        'yopmail.com',
        'guerrillamail.com',
        'temp-mail.org',
        'throwaway.email',
        'getnada.com',
        'sharklasers.com',
        'spam4.me',
      ]

      for (const domain of disposableDomains) {
        const result = await validateEmail(`test@${domain}`)
        expect(result.isValid).toBe(false)
        expect(result.reason).toBe('Disposable email addresses are not allowed')
        expect(result.checks.disposable).toBe(false)
      }
    })

    it.concurrent('should accept valid email formats', async () => {
      const validEmails = [
        'simple@example.com',
        'very.common@example.com',
        'disposable.style.email.with+symbol@example.com',
        'other.email-with-hyphen@example.com',
        'fully-qualified-domain@example.com',
        'user.name+tag+sorting@example.com',
        'x@example.com',
        'example-indeed@strange-example.com',
        'example@s.example',
      ]

      for (const email of validEmails) {
        const result = await validateEmail(email)
        // We check syntax passes; MX might fail for fake domains
        expect(result.checks.syntax).toBe(true)
        expect(result.checks.disposable).toBe(true)
      }
    })

    it.concurrent('should return high confidence for syntax failures', async () => {
      const result = await validateEmail('not-an-email')
      expect(result.confidence).toBe('high')
    })

    it.concurrent('should handle email with special characters in local part', async () => {
      const result = await validateEmail("user!#$%&'*+/=?^_`{|}~@example.com")
      expect(result.checks.syntax).toBe(true)
    })
  })

  describe('quickValidateEmail', () => {
    it.concurrent('should validate quickly without MX check', () => {
      const result = quickValidateEmail('user@example.com')
      expect(result.isValid).toBe(true)
      expect(result.checks.mxRecord).toBe(true) // Skipped, so assumed true
      expect(result.confidence).toBe('medium')
    })

    it.concurrent('should reject invalid emails quickly', () => {
      const result = quickValidateEmail('invalid-email')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should reject disposable emails quickly', () => {
      const result = quickValidateEmail('test@tempmail.org')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Disposable email addresses are not allowed')
    })

    it.concurrent('should reject email with missing domain', () => {
      const result = quickValidateEmail('user@')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should reject email with invalid domain format', () => {
      const result = quickValidateEmail('user@.invalid')
      expect(result.isValid).toBe(false)
      // The regex catches this as a syntax error before domain validation
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should return medium confidence for suspicious patterns', () => {
      const result = quickValidateEmail('user..double@example.com')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Email contains suspicious patterns')
      expect(result.confidence).toBe('medium')
    })

    it.concurrent('should return high confidence for syntax errors', () => {
      const result = quickValidateEmail('not-valid-email')
      expect(result.confidence).toBe('high')
    })

    it.concurrent('should handle empty string', () => {
      const result = quickValidateEmail('')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should handle email with only @ symbol', () => {
      const result = quickValidateEmail('@')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should handle email with spaces', () => {
      const result = quickValidateEmail('user name@example.com')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should handle email with multiple @ symbols', () => {
      const result = quickValidateEmail('user@domain@example.com')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Invalid email format')
    })

    it.concurrent('should validate complex but valid local parts', () => {
      const result = quickValidateEmail('user+tag@example.com')
      expect(result.isValid).toBe(true)
      expect(result.checks.syntax).toBe(true)
    })

    it.concurrent('should validate subdomains', () => {
      const result = quickValidateEmail('user@mail.subdomain.example.com')
      expect(result.isValid).toBe(true)
      expect(result.checks.domain).toBe(true)
    })
  })
})
