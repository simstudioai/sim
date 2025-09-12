import { describe, expect, it } from 'vitest'
import { quickValidateEmail, validateEmail } from './validation'

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

    it.concurrent('should accept legitimate business emails', async () => {
      const legitimateEmails = [
        'test@gmail.com',
        'no-reply@yahoo.com',
        'user12345@outlook.com',
        'longusernamehere@gmail.com',
      ]

      for (const email of legitimateEmails) {
        const result = await validateEmail(email)
        expect(result.isValid).toBe(true)
      }
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
  })
})
