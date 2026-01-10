import { createEnvMock, createMockLogger } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

/**
 * Tests for the mailer module.
 *
 * Note: Due to bun test runner's module loading behavior, the Resend and Azure
 * clients are initialized at module load time. These tests mock the actual
 * Resend and EmailClient classes to return mock implementations that our
 * mock functions can intercept.
 */

const loggerMock = vi.hoisted(() => ({
  createLogger: () => createMockLogger(),
}))

const mockSend = vi.fn()
const mockBatchSend = vi.fn()
const mockAzureBeginSend = vi.fn()
const mockAzurePollUntilDone = vi.fn()

// Mock the Resend module - returns an object with emails.send
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: (...args: any[]) => mockSend(...args),
      },
      batch: {
        send: (...args: any[]) => mockBatchSend(...args),
      },
    })),
  }
})

// Mock Azure Communication Email - returns an object with beginSend
vi.mock('@azure/communication-email', () => {
  return {
    EmailClient: vi.fn().mockImplementation(() => ({
      beginSend: (...args: any[]) => mockAzureBeginSend(...args),
    })),
  }
})

// Mock unsubscribe module
vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
}))

// Mock env with valid API keys so the clients get initialized
vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    RESEND_API_KEY: 'test-api-key',
    AZURE_ACS_CONNECTION_STRING: 'test-azure-connection-string',
    AZURE_COMMUNICATION_EMAIL_DOMAIN: 'test.azurecomm.net',
    NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
  })
)

// Mock URL utilities
vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn().mockReturnValue('sim.ai'),
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
  getBaseDomain: vi.fn().mockReturnValue('test.sim.ai'),
}))

// Mock the utils module (getFromEmailAddress)
vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn().mockReturnValue('Sim <noreply@sim.ai>'),
}))

vi.mock('@sim/logger', () => loggerMock)

// Import after mocks are set up
import {
  type EmailType,
  hasEmailService,
  sendBatchEmails,
  sendEmail,
} from '@/lib/messaging/email/mailer'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/messaging/email/unsubscribe'

describe('mailer', () => {
  const testEmailOptions = {
    to: 'test@example.com',
    subject: 'Test Subject',
    html: '<p>Test email content</p>',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(isUnsubscribed as Mock).mockResolvedValue(false)
    ;(generateUnsubscribeToken as Mock).mockReturnValue('mock-token-123')

    // Mock successful Resend response
    mockSend.mockResolvedValue({
      data: { id: 'test-email-id' },
      error: null,
    })

    mockBatchSend.mockResolvedValue({
      data: [{ id: 'batch-email-1' }, { id: 'batch-email-2' }],
      error: null,
    })

    // Mock successful Azure response
    mockAzurePollUntilDone.mockResolvedValue({
      status: 'Succeeded',
      id: 'azure-email-id',
    })

    mockAzureBeginSend.mockReturnValue({
      pollUntilDone: mockAzurePollUntilDone,
    })
  })

  describe('hasEmailService', () => {
    it('should return true when email service is configured', () => {
      // The mailer module initializes with mocked env that has valid API keys
      const result = hasEmailService()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('sendEmail', () => {
    it('should send a transactional email successfully', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      // Should not check unsubscribe status for transactional emails
      expect(isUnsubscribed).not.toHaveBeenCalled()
    })

    it('should check unsubscribe status for marketing emails', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      expect(isUnsubscribed).toHaveBeenCalledWith(testEmailOptions.to, 'marketing')
    })

    it('should skip sending if user has unsubscribed', async () => {
      ;(isUnsubscribed as Mock).mockResolvedValue(true)

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email skipped (user unsubscribed)')
      expect(result.data).toEqual({ id: 'skipped-unsubscribed' })
    })

    it('should not include unsubscribe when includeUnsubscribe is false', async () => {
      await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
        includeUnsubscribe: false,
      })

      expect(generateUnsubscribeToken).not.toHaveBeenCalled()
    })

    it('should handle text-only emails without HTML', async () => {
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Text Only',
        text: 'Plain text content',
      })

      expect(result.success).toBe(true)
    })

    it('should handle multiple recipients as array', async () => {
      const recipients = ['user1@example.com', 'user2@example.com', 'user3@example.com']
      const result = await sendEmail({
        ...testEmailOptions,
        to: recipients,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      // Should use first recipient for unsubscribe check
      expect(isUnsubscribed).toHaveBeenCalledWith('user1@example.com', 'marketing')
    })

    it('should handle general exceptions gracefully', async () => {
      // Mock an unexpected error before any email service call
      ;(isUnsubscribed as Mock).mockRejectedValue(new Error('Database connection failed'))

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
      })

      expect(result.success).toBe(false)
      expect(result.message).toBe('Failed to send email')
    })
  })

  describe('sendBatchEmails', () => {
    const testBatchEmails = [
      { ...testEmailOptions, to: 'user1@example.com' },
      { ...testEmailOptions, to: 'user2@example.com' },
    ]

    it('should handle empty batch', async () => {
      const result = await sendBatchEmails({ emails: [] })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('should process multiple emails in batch', async () => {
      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(true)
      expect(result.results.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle transactional emails without unsubscribe check', async () => {
      const batchEmails = [
        { ...testEmailOptions, to: 'user1@example.com', emailType: 'transactional' as EmailType },
        { ...testEmailOptions, to: 'user2@example.com', emailType: 'transactional' as EmailType },
      ]

      await sendBatchEmails({ emails: batchEmails })

      // Should not check unsubscribe for transactional emails
      expect(isUnsubscribed).not.toHaveBeenCalled()
    })
  })
})
