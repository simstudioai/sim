import { validateAndNormalizeEmail } from '@/lib/email/utils'

describe('validateAndNormalizeEmail', () => {
  describe('valid emails', () => {
    it.concurrent('should validate simple email addresses', () => {
      const result = validateAndNormalizeEmail('test@example.com')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('test@example.com')
    })

    it.concurrent('should validate emails with subdomains', () => {
      const result = validateAndNormalizeEmail('user@mail.example.com')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('user@mail.example.com')
    })

    it.concurrent('should validate emails with numbers and hyphens', () => {
      const result = validateAndNormalizeEmail('user123@test-domain.co.uk')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('user123@test-domain.co.uk')
    })

    it.concurrent('should validate emails with special characters in local part', () => {
      const result = validateAndNormalizeEmail('user.name+tag@example.com')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('user.name+tag@example.com')
    })
  })

  describe('invalid emails', () => {
    it.concurrent('should reject emails without @ symbol', () => {
      const result = validateAndNormalizeEmail('testexample.com')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('testexample.com')
    })

    it.concurrent('should reject emails without domain', () => {
      const result = validateAndNormalizeEmail('test@')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('test@')
    })

    it.concurrent('should reject emails without local part', () => {
      const result = validateAndNormalizeEmail('@example.com')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('@example.com')
    })

    it.concurrent('should reject emails without TLD', () => {
      const result = validateAndNormalizeEmail('test@domain')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('test@domain')
    })

    it.concurrent('should reject empty strings', () => {
      const result = validateAndNormalizeEmail('')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('')
    })

    it.concurrent('should reject emails with spaces', () => {
      const result = validateAndNormalizeEmail('test @example.com')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('test @example.com')
    })

    it.concurrent('should reject emails with multiple @ symbols', () => {
      const result = validateAndNormalizeEmail('test@@example.com')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('test@@example.com')
    })
  })

  describe('normalization', () => {
    it.concurrent('should trim whitespace from email', () => {
      const result = validateAndNormalizeEmail('  test@example.com  ')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('test@example.com')
    })

    it.concurrent('should convert email to lowercase', () => {
      const result = validateAndNormalizeEmail('Test.User@EXAMPLE.COM')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('test.user@example.com')
    })

    it.concurrent('should trim and convert to lowercase together', () => {
      const result = validateAndNormalizeEmail('  Test.User@EXAMPLE.COM  ')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('test.user@example.com')
    })

    it.concurrent('should normalize invalid emails as well', () => {
      const result = validateAndNormalizeEmail('  INVALID EMAIL  ')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('invalid email')
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle only whitespace', () => {
      const result = validateAndNormalizeEmail('   ')
      expect(result.isValid).toBe(false)
      expect(result.normalized).toBe('')
    })

    it.concurrent('should handle tab and newline characters', () => {
      const result = validateAndNormalizeEmail('\t\ntest@example.com\t\n')
      expect(result.isValid).toBe(true)
      expect(result.normalized).toBe('test@example.com')
    })
  })
})
