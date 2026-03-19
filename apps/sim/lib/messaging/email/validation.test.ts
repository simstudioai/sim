import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isDisposableEmailFull,
  isDisposableMxBackend,
  quickValidateEmail,
  validateEmail,
} from '@/lib/messaging/email/validation'

vi.mock('@sim/logger', () => loggerMock)

const { mockResolveMx } = vi.hoisted(() => ({
  mockResolveMx: vi.fn(
    (
      _domain: string,
      callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
    ) => {
      callback(null, [{ exchange: 'mail.example.com', priority: 10 }])
    }
  ),
}))

vi.mock('dns', () => ({
  resolveMx: mockResolveMx,
}))

describe('Email Validation', () => {
  beforeEach(() => {
    mockResolveMx.mockImplementation(
      (
        _domain: string,
        callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
      ) => {
        callback(null, [{ exchange: 'mail.example.com', priority: 10 }])
      }
    )
  })

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

  describe('isDisposableEmailFull', () => {
    it('should reject domains from the inline blocklist', () => {
      expect(isDisposableEmailFull('user@sharebot.net')).toBe(true)
      expect(isDisposableEmailFull('user@oakon.com')).toBe(true)
      expect(isDisposableEmailFull('user@catchmail.io')).toBe(true)
      expect(isDisposableEmailFull('user@salt.email')).toBe(true)
      expect(isDisposableEmailFull('user@mail.gw')).toBe(true)
      expect(isDisposableEmailFull('user@mailinator.com')).toBe(true)
    })

    it('should reject domains from the npm package list that are not in the inline list', () => {
      expect(isDisposableEmailFull('user@0-mail.com')).toBe(true)
      expect(isDisposableEmailFull('user@0-180.com')).toBe(true)
    })

    it('should allow legitimate email domains', () => {
      expect(isDisposableEmailFull('user@gmail.com')).toBe(false)
      expect(isDisposableEmailFull('user@company.com')).toBe(false)
      expect(isDisposableEmailFull('user@outlook.com')).toBe(false)
    })

    it('should handle invalid input', () => {
      expect(isDisposableEmailFull('')).toBe(false)
      expect(isDisposableEmailFull('nodomain')).toBe(false)
      expect(isDisposableEmailFull('user@')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(isDisposableEmailFull('user@MAILINATOR.COM')).toBe(true)
      expect(isDisposableEmailFull('user@ShareBot.Net')).toBe(true)
    })
  })

  describe('isDisposableMxBackend', () => {
    it('should detect mail.gw MX backend', async () => {
      mockResolveMx.mockImplementation(
        (
          _domain: string,
          callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
        ) => {
          callback(null, [{ exchange: 'in.mail.gw', priority: 10 }])
        }
      )
      expect(await isDisposableMxBackend('user@some-random-domain.xyz')).toBe(true)
    })

    it('should detect catchmail.io MX backend', async () => {
      mockResolveMx.mockImplementation(
        (
          _domain: string,
          callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
        ) => {
          callback(null, [{ exchange: 'smtp.catchmail.io', priority: 10 }])
        }
      )
      expect(await isDisposableMxBackend('user@custom-domain.com')).toBe(true)
    })

    it('should handle trailing dot in MX exchange', async () => {
      mockResolveMx.mockImplementation(
        (
          _domain: string,
          callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
        ) => {
          callback(null, [{ exchange: 'in.mail.gw.', priority: 10 }])
        }
      )
      expect(await isDisposableMxBackend('user@trailing-dot.com')).toBe(true)
    })

    it('should allow legitimate MX backends', async () => {
      mockResolveMx.mockImplementation(
        (
          _domain: string,
          callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
        ) => {
          callback(null, [{ exchange: 'aspmx.l.google.com', priority: 10 }])
        }
      )
      expect(await isDisposableMxBackend('user@legitimate.com')).toBe(false)
    })

    it('should return false on DNS errors', async () => {
      mockResolveMx.mockImplementation(
        (_domain: string, callback: (err: Error | null, addresses: null) => void) => {
          callback(new Error('ENOTFOUND'), null)
        }
      )
      expect(await isDisposableMxBackend('user@nonexistent.invalid')).toBe(false)
    })

    it('should return false for invalid input', async () => {
      expect(await isDisposableMxBackend('')).toBe(false)
      expect(await isDisposableMxBackend('nodomain')).toBe(false)
    })
  })

  describe('validateEmail with disposable MX backend', () => {
    it('should reject emails with disposable MX backend even if domain is not in blocklist', async () => {
      mockResolveMx.mockImplementation(
        (
          _domain: string,
          callback: (err: Error | null, addresses: { exchange: string; priority: number }[]) => void
        ) => {
          callback(null, [{ exchange: 'in.mail.gw', priority: 10 }])
        }
      )
      const result = await validateEmail('user@unknown-disposable.xyz')
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Disposable email addresses are not allowed')
      expect(result.checks.disposable).toBe(false)
    })
  })
})
