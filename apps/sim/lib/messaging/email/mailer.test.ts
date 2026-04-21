import { createEnvMock } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockSend = vi.fn()
const mockBatchSend = vi.fn()
const mockAzureBeginSend = vi.fn()
const mockAzurePollUntilDone = vi.fn()

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

vi.mock('@azure/communication-email', () => {
  return {
    EmailClient: vi.fn().mockImplementation(() => ({
      beginSend: (...args: any[]) => mockAzureBeginSend(...args),
    })),
  }
})

vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    RESEND_API_KEY: 'test-api-key',
    AZURE_ACS_CONNECTION_STRING: 'test-azure-connection-string',
    AZURE_COMMUNICATION_EMAIL_DOMAIN: 'test.azurecomm.net',
    NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
  })
)

vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: vi.fn().mockReturnValue('sim.ai'),
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
  getBaseDomain: vi.fn().mockReturnValue('test.sim.ai'),
}))

vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn().mockReturnValue('Sim <noreply@sim.ai>'),
  hasEmailHeaderControlChars: vi.fn().mockImplementation((value: string) => /[\r\n]/.test(value)),
  EMAIL_HEADER_CONTROL_CHARS_REGEX: /[\r\n]/,
  NO_EMAIL_HEADER_CONTROL_CHARS_REGEX: /^[^\r\n]*$/,
}))

import { type EmailType, hasEmailService, sendBatchEmails, sendEmail } from './mailer'
import { generateUnsubscribeToken, isUnsubscribed } from './unsubscribe'

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

    mockSend.mockResolvedValue({
      data: { id: 'test-email-id' },
      error: null,
    })

    mockBatchSend.mockResolvedValue({
      data: [{ id: 'batch-email-1' }, { id: 'batch-email-2' }],
      error: null,
    })

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

    it('should sanitize CRLF characters in subjects before sending', async () => {
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Hello\r\nBcc: attacker@evil.com',
        text: 'Plain text content',
      })

      expect(result.success).toBe(true)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Hello Bcc: attacker@evil.com',
        })
      )
    })

    it('should reject reply-to values containing header control characters', async () => {
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        text: 'Plain text content',
        replyTo: 'user@example.com\r\nBcc: attacker@evil.com',
      })

      expect(result.success).toBe(false)
      expect(result.message).toBe('Failed to send email')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle multiple recipients as array', async () => {
      const recipients = ['user1@example.com', 'user2@example.com', 'user3@example.com']
      const result = await sendEmail({
        ...testEmailOptions,
        to: recipients,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      expect(isUnsubscribed).toHaveBeenCalledWith('user1@example.com', 'marketing')
    })

    it('should handle general exceptions gracefully', async () => {
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

    it('should sanitize CRLF characters in batch email subjects', async () => {
      await sendBatchEmails({
        emails: [
          {
            ...testEmailOptions,
            subject: 'Batch\r\nCc: attacker@evil.com',
          },
        ],
      })

      expect(mockBatchSend).toHaveBeenCalledWith([
        expect.objectContaining({
          subject: 'Batch Cc: attacker@evil.com',
        }),
      ])
    })

    it('should handle transactional emails without unsubscribe check', async () => {
      const batchEmails = [
        { ...testEmailOptions, to: 'user1@example.com', emailType: 'transactional' as EmailType },
        { ...testEmailOptions, to: 'user2@example.com', emailType: 'transactional' as EmailType },
      ]

      await sendBatchEmails({ emails: batchEmails })

      expect(isUnsubscribed).not.toHaveBeenCalled()
    })
  })
})
