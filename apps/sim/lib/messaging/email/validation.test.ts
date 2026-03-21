import { describe, expect, it } from 'vitest'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

describe('quickValidateEmail', () => {
  it.concurrent('should validate a correct email', () => {
    const result = quickValidateEmail('user@example.com')
    expect(result.isValid).toBe(true)
    expect(result.checks.syntax).toBe(true)
    expect(result.checks.disposable).toBe(true)
    expect(result.checks.mxRecord).toBe(true)
    expect(result.confidence).toBe('medium')
  })

  it.concurrent('should reject invalid syntax', () => {
    const result = quickValidateEmail('invalid-email')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid email format')
  })

  it.concurrent('should reject disposable email addresses', () => {
    const disposableDomains = [
      'mailinator.com',
      'yopmail.com',
      'guerrillamail.com',
      'temp-mail.org',
      'throwaway.email',
      'getnada.com',
      'sharklasers.com',
      'spam4.me',
      'sharebot.net',
      'oakon.com',
      'catchmail.io',
      'salt.email',
      'mail.gw',
      'tempmail.org',
    ]

    for (const domain of disposableDomains) {
      const result = quickValidateEmail(`test@${domain}`)
      expect(result.isValid).toBe(false)
      expect(result.reason).toBe('Disposable email addresses are not allowed')
      expect(result.checks.disposable).toBe(false)
    }
  })

  it.concurrent('should reject consecutive dots (RFC violation)', () => {
    const result = quickValidateEmail('user..name@example.com')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Email contains suspicious patterns')
    expect(result.confidence).toBe('medium')
  })

  it.concurrent('should reject very long local parts (RFC violation)', () => {
    const longLocalPart = 'a'.repeat(65)
    const result = quickValidateEmail(`${longLocalPart}@example.com`)
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Email contains suspicious patterns')
  })

  it.concurrent('should reject email with missing domain', () => {
    const result = quickValidateEmail('user@')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid email format')
  })

  it.concurrent('should reject email with domain starting with dot', () => {
    const result = quickValidateEmail('user@.example.com')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid email format')
  })

  it.concurrent('should reject email with domain ending with dot', () => {
    const result = quickValidateEmail('user@example.')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid email format')
  })

  it.concurrent('should reject email with domain missing TLD', () => {
    const result = quickValidateEmail('user@localhost')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid domain format')
  })

  it.concurrent('should reject email longer than 254 characters', () => {
    const longLocal = 'a'.repeat(64)
    const longDomain = `${'b'.repeat(180)}.com`
    const result = quickValidateEmail(`${longLocal}@${longDomain}`)
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should accept valid email formats', () => {
    const validEmails = [
      'simple@example.com',
      'very.common@example.com',
      'disposable.style.email.with+symbol@example.com',
      'other.email-with-hyphen@example.com',
      'user.name+tag+sorting@example.com',
      'x@example.com',
      'example-indeed@strange-example.com',
      'example@s.example',
    ]

    for (const email of validEmails) {
      const result = quickValidateEmail(email)
      expect(result.isValid).toBe(true)
      expect(result.checks.syntax).toBe(true)
      expect(result.checks.disposable).toBe(true)
    }
  })

  it.concurrent('should return high confidence for syntax errors', () => {
    const result = quickValidateEmail('not-valid-email')
    expect(result.confidence).toBe('high')
  })

  it.concurrent('should handle special characters in local part', () => {
    const result = quickValidateEmail("user!#$%&'*+/=?^_`{|}~@example.com")
    expect(result.checks.syntax).toBe(true)
  })

  it.concurrent('should handle empty string', () => {
    const result = quickValidateEmail('')
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('Invalid email format')
  })

  it.concurrent('should handle email with only @ symbol', () => {
    const result = quickValidateEmail('@')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should handle email with spaces', () => {
    const result = quickValidateEmail('user name@example.com')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should handle email with multiple @ symbols', () => {
    const result = quickValidateEmail('user@domain@example.com')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should validate subdomains', () => {
    const result = quickValidateEmail('user@mail.subdomain.example.com')
    expect(result.isValid).toBe(true)
    expect(result.checks.domain).toBe(true)
  })
})
