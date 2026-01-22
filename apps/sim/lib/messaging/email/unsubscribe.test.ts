import { createEnvMock, createMockLogger } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailType } from '@/lib/messaging/email/mailer'

const loggerMock = vi.hoisted(() => ({
  createLogger: () => createMockLogger(),
}))

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

vi.mock('@sim/db/schema', () => ({
  user: { id: 'id', email: 'email' },
  settings: {
    userId: 'userId',
    emailPreferences: 'emailPreferences',
    id: 'id',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ type: 'eq', left: a, right: b })),
}))

vi.mock('@/lib/core/config/env', () => createEnvMock({ BETTER_AUTH_SECRET: 'test-secret-key' }))

vi.mock('@sim/logger', () => loggerMock)

import {
  generateUnsubscribeToken,
  getEmailPreferences,
  isTransactionalEmail,
  isUnsubscribed,
  resubscribe,
  unsubscribeFromAll,
  updateEmailPreferences,
  verifyUnsubscribeToken,
} from '@/lib/messaging/email/unsubscribe'

describe('unsubscribe utilities', () => {
  const testEmail = 'test@example.com'
  const testEmailType = 'marketing'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateUnsubscribeToken', () => {
    it.concurrent('should generate a token with salt:hash:emailType format', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const parts = token.split(':')

      expect(parts).toHaveLength(3)
      expect(parts[0]).toHaveLength(32) // Salt should be 32 chars (16 bytes hex)
      expect(parts[1]).toHaveLength(64) // SHA256 hash should be 64 chars
      expect(parts[2]).toBe(testEmailType)
    })

    it.concurrent(
      'should generate different tokens for the same email (due to random salt)',
      () => {
        const token1 = generateUnsubscribeToken(testEmail, testEmailType)
        const token2 = generateUnsubscribeToken(testEmail, testEmailType)

        expect(token1).not.toBe(token2)
      }
    )

    it.concurrent('should default to marketing email type', () => {
      const token = generateUnsubscribeToken(testEmail)
      const parts = token.split(':')

      expect(parts[2]).toBe('marketing')
    })

    it.concurrent('should generate different tokens for different email types', () => {
      const marketingToken = generateUnsubscribeToken(testEmail, 'marketing')
      const updatesToken = generateUnsubscribeToken(testEmail, 'updates')

      expect(marketingToken).not.toBe(updatesToken)
    })
  })

  describe('verifyUnsubscribeToken', () => {
    it.concurrent('should verify a valid token', () => {
      const token = generateUnsubscribeToken(testEmail, testEmailType)
      const result = verifyUnsubscribeToken(testEmail, token)

      expect(result.valid).toBe(true)
      expect(result.emailType).toBe(testEmailType)
    })

    it.concurrent('should reject an invalid token', () => {
      const invalidToken = 'invalid:token:format'
      const result = verifyUnsubscribeToken(testEmail, invalidToken)

      expect(result.valid).toBe(false)
      expect(result.emailType).toBe('format')
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

  describe('isTransactionalEmail', () => {
    it.concurrent('should identify transactional emails correctly', () => {
      expect(isTransactionalEmail('transactional')).toBe(true)
    })

    it.concurrent('should identify non-transactional emails correctly', () => {
      const nonTransactionalTypes: EmailType[] = ['marketing', 'updates', 'notifications']

      nonTransactionalTypes.forEach((type) => {
        expect(isTransactionalEmail(type)).toBe(false)
      })
    })
  })

  describe('getEmailPreferences', () => {
    it('should return email preferences for a user', async () => {
      const mockPreferences = {
        unsubscribeAll: false,
        unsubscribeMarketing: true,
      }

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ emailPreferences: mockPreferences }]),
            }),
          }),
        }),
      })

      const result = await getEmailPreferences(testEmail)

      expect(result).toEqual(mockPreferences)
    })

    it('should return null when user is not found', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })

      const result = await getEmailPreferences(testEmail)

      expect(result).toBeNull()
    })

    it('should return empty object when emailPreferences is null', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ emailPreferences: null }]),
            }),
          }),
        }),
      })

      const result = await getEmailPreferences(testEmail)

      expect(result).toEqual({})
    })

    it('should return null on database error', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('Database connection failed')),
            }),
          }),
        }),
      })

      const result = await getEmailPreferences(testEmail)

      expect(result).toBeNull()
    })
  })

  describe('updateEmailPreferences', () => {
    it('should update email preferences for existing user', async () => {
      const userId = 'user-123'

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
            limit: vi.fn().mockResolvedValue([{ emailPreferences: { unsubscribeAll: false } }]),
          }),
        }),
      })

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      })

      const result = await updateEmailPreferences(testEmail, { unsubscribeMarketing: true })

      expect(result).toBe(true)
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('should return false when user is not found', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const result = await updateEmailPreferences(testEmail, { unsubscribeMarketing: true })

      expect(result).toBe(false)
    })

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

    it('should return false on database error', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error')),
          }),
        }),
      })

      const result = await updateEmailPreferences(testEmail, { unsubscribeMarketing: true })

      expect(result).toBe(false)
    })
  })

  describe('isUnsubscribed', () => {
    it('should return false when user has no preferences', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'marketing')

      expect(result).toBe(false)
    })

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

    it('should return false when specific type is not unsubscribed', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([
                  { emailPreferences: { unsubscribeMarketing: false, unsubscribeUpdates: true } },
                ]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'marketing')

      expect(result).toBe(false)
    })

    it('should check updates unsubscribe status', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ emailPreferences: { unsubscribeUpdates: true } }]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'updates')

      expect(result).toBe(true)
    })

    it('should check notifications unsubscribe status', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ emailPreferences: { unsubscribeNotifications: true } }]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'notifications')

      expect(result).toBe(true)
    })

    it('should return false for unknown email type', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ emailPreferences: {} }]),
            }),
          }),
        }),
      })

      const result = await isUnsubscribed(testEmail, 'all')

      expect(result).toBe(false)
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

  describe('unsubscribeFromAll', () => {
    it('should call updateEmailPreferences with unsubscribeAll: true', async () => {
      const userId = 'user-123'

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
            limit: vi.fn().mockResolvedValue([{ emailPreferences: {} }]),
          }),
        }),
      })

      const mockInsertValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.insert.mockReturnValue({
        values: mockInsertValues,
      })

      const result = await unsubscribeFromAll(testEmail)

      expect(result).toBe(true)
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          emailPreferences: expect.objectContaining({ unsubscribeAll: true }),
        })
      )
    })
  })

  describe('resubscribe', () => {
    it('should reset all unsubscribe flags to false', async () => {
      const userId = 'user-123'

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
            limit: vi.fn().mockResolvedValue([
              {
                emailPreferences: {
                  unsubscribeAll: true,
                  unsubscribeMarketing: true,
                  unsubscribeUpdates: true,
                  unsubscribeNotifications: true,
                },
              },
            ]),
          }),
        }),
      })

      const mockInsertValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.insert.mockReturnValue({
        values: mockInsertValues,
      })

      const result = await resubscribe(testEmail)

      expect(result).toBe(true)
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          emailPreferences: {
            unsubscribeAll: false,
            unsubscribeMarketing: false,
            unsubscribeUpdates: false,
            unsubscribeNotifications: false,
          },
        })
      )
    })
  })
})
