import { databaseMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({ BETTER_AUTH_SECRET: 'test-secret-key' })
})

afterAll(resetEnvMock)

const mockDb = databaseMock.db as Record<string, ReturnType<typeof vi.fn>>

import {
  generateUnsubscribeToken,
  isUnsubscribed,
  updateEmailPreferences,
  verifyUnsubscribeToken,
} from '@/lib/messaging/email/unsubscribe'

describe('unsubscribe utilities', () => {
  const testEmail = 'test@example.com'
  const testEmailType = 'marketing'

  describe('verifyUnsubscribeToken', () => {
    it.concurrent('should verify a valid token', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const result = verifyUnsubscribeToken(testEmail, token)

      expect(result.valid).toBe(true)
      expect(result.emailType).toBe(testEmailType)
    })

    it.concurrent('should reject a token for wrong email', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const result = verifyUnsubscribeToken('wrong@example.com', token)

      expect(result.valid).toBe(false)
    })

    it.concurrent('should handle legacy tokens (2 parts) and default to marketing', () => {
      const salt = 'abc123'
      const secret = 'test-secret-key'
      const { createHash } = require('crypto')
      const hash = createHash('sha256').update(`${testEmail}:${salt}:${secret}`).digest('hex')
      const legacyToken = `${salt}:${hash}`

      const result = verifyUnsubscribeToken(testEmail, legacyToken)
      expect(result.valid).toBe(true)
      expect(result.emailType).toBe('marketing')
    })

    it.concurrent('should reject malformed tokens', () => {
      const malformedTokens = ['', 'single-part', 'too:many:parts:here:invalid', ':empty:parts:']

      malformedTokens.forEach((token) => {
        const result = verifyUnsubscribeToken(testEmail, token)
        expect(result.valid).toBe(false)
      })
    })
  })

  describe('updateEmailPreferences', () => {
    it('should merge with existing preferences', async () => {
      const userId = 'user-123'
      const existingPrefs = { unsubscribeAll: false, unsubscribeUpdates: true }

      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: userId }]),
          }),
        }),
      })

      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ emailPreferences: existingPrefs }]),
          }),
        }),
      })

      const mockInsertValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.insert.mockReturnValue({
        values: mockInsertValues,
      })

      await updateEmailPreferences(testEmail, { unsubscribeMarketing: true })

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          emailPreferences: {
            unsubscribeAll: false,
            unsubscribeUpdates: true,
            unsubscribeMarketing: true,
          },
        })
      )
    })
  })

  describe('isUnsubscribed', () => {
    it('should return true when unsubscribeAll is true', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ emailPreferences: { unsubscribeAll: true } }]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'marketing')

      expect(result).toBe(true)
    })

    it('should return true when specific type is unsubscribed', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([
                  { emailPreferences: { unsubscribeMarketing: true, unsubscribeUpdates: false } },
                ]),
            }),
          }),
        }),
      })

      const resultMarketing = await isUnsubscribed(testEmail, 'marketing')
      expect(resultMarketing).toBe(true)
    })

    it('should return false on database error', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('Database error')),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'marketing')

      expect(result).toBe(false)
    })
  })
})
