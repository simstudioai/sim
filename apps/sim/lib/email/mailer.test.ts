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

vi.mock('@/lib/email/unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: {
    RESEND_API_KEY: 'test-api-key',
    AZURE_ACS_CONNECTION_STRING: 'test-azure-connection-string',
    AZURE_COMMUNICATION_EMAIL_DOMAIN: 'test.azurecomm.net',
    NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
  },
}))

vi.mock('@/lib/urls/utils', () => ({
  getEmailDomain: vi.fn().mockReturnValue('sim.ai'),
}))

import { type EmailType, sendBatchEmails, sendEmail } from '@/lib/email/mailer'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/email/unsubscribe'

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

  describe('sendEmail', () => {
    it('should send a transactional email successfully', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Resend')
      expect(result.data).toEqual({ id: 'test-email-id' })

      // Should not check unsubscribe status for transactional emails
      expect(isUnsubscribed).not.toHaveBeenCalled()

      // Should call Resend with correct parameters
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Sim <noreply@sim.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: testEmailOptions.html,
        headers: undefined, // No unsubscribe headers for transactional
      })
    })

    it('should send a marketing email with unsubscribe headers', async () => {
      const htmlWithToken = '<p>Test content</p><a href="{{UNSUBSCRIBE_TOKEN}}">Unsubscribe</a>'

      const result = await sendEmail({
        ...testEmailOptions,
        html: htmlWithToken,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)

      // Should check unsubscribe status
      expect(isUnsubscribed).toHaveBeenCalledWith(testEmailOptions.to, 'marketing')

      // Should generate unsubscribe token
      expect(generateUnsubscribeToken).toHaveBeenCalledWith(testEmailOptions.to, 'marketing')

      // Should call Resend with unsubscribe headers
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Sim <noreply@sim.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: '<p>Test content</p><a href="mock-token-123">Unsubscribe</a>',
        headers: {
          'List-Unsubscribe':
            '<https://test.sim.ai/unsubscribe?token=mock-token-123&email=test%40example.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
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

      // Should not call Resend
      expect(mockSend).not.toHaveBeenCalled()
    })

    it.concurrent('should handle Resend API errors and fallback to Azure', async () => {
      // Mock Resend to fail
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API rate limit exceeded' },
      })

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

      // Should have tried Resend first
      expect(mockSend).toHaveBeenCalled()

      // Should have fallen back to Azure
      expect(mockAzureBeginSend).toHaveBeenCalled()
    })

    it.concurrent('should handle unexpected errors and fallback to Azure', async () => {
      // Mock Resend to throw an error
      mockSend.mockRejectedValue(new Error('Network error'))

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

      // Should have tried Resend first
      expect(mockSend).toHaveBeenCalled()

      // Should have fallen back to Azure
      expect(mockAzureBeginSend).toHaveBeenCalled()
    })

    it.concurrent('should use custom from address when provided', async () => {
      await sendEmail({
        ...testEmailOptions,
        from: 'custom@example.com',
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        })
      )
    })

    it('should not include unsubscribe when includeUnsubscribe is false', async () => {
      await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
        includeUnsubscribe: false,
      })

      expect(generateUnsubscribeToken).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: undefined,
        })
      )
    })

    it.concurrent('should replace unsubscribe token placeholders in HTML', async () => {
      const htmlWithPlaceholder = '<p>Content</p><a href="{{UNSUBSCRIBE_TOKEN}}">Unsubscribe</a>'

      await sendEmail({
        ...testEmailOptions,
        html: htmlWithPlaceholder,
        emailType: 'updates' as EmailType,
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<p>Content</p><a href="mock-token-123">Unsubscribe</a>',
        })
      )
    })
  })

  describe('Azure Communication Services fallback', () => {
    it('should fallback to Azure when Resend fails', async () => {
      // Mock Resend to fail
      mockSend.mockRejectedValue(new Error('Resend service unavailable'))

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

      // Should have tried Resend first
      expect(mockSend).toHaveBeenCalled()

      // Should have fallen back to Azure
      expect(mockAzureBeginSend).toHaveBeenCalledWith({
        senderAddress: 'noreply@sim.ai',
        content: {
          subject: testEmailOptions.subject,
          html: testEmailOptions.html,
        },
        recipients: {
          to: [{ address: testEmailOptions.to }],
        },
        headers: {},
      })
    })

    it('should handle Azure Communication Services failure', async () => {
      // Mock both services to fail
      mockSend.mockRejectedValue(new Error('Resend service unavailable'))
      mockAzurePollUntilDone.mockResolvedValue({
        status: 'Failed',
        id: 'failed-id',
      })

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(false)
      expect(result.message).toBe('Both Resend and Azure Communication Services failed')

      // Should have tried both services
      expect(mockSend).toHaveBeenCalled()
      expect(mockAzureBeginSend).toHaveBeenCalled()
    })
  })

  describe('sendBatchEmails', () => {
    const testBatchEmails = [
      { ...testEmailOptions, to: 'user1@example.com' },
      { ...testEmailOptions, to: 'user2@example.com' },
    ]

    it('should send batch emails via Resend successfully', async () => {
      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully via Resend')
      expect(result.results).toHaveLength(2)
      expect(mockBatchSend).toHaveBeenCalled()
    })

    it('should fallback to individual sends when Resend batch fails', async () => {
      // Mock Resend batch to fail
      mockBatchSend.mockRejectedValue(new Error('Batch service unavailable'))

      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully')
      expect(result.results).toHaveLength(2)

      // Should have tried Resend batch first
      expect(mockBatchSend).toHaveBeenCalled()

      // Should have fallen back to individual sends (which will use Resend since it's available)
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('should handle mixed success/failure in individual fallback', async () => {
      // Mock Resend batch to fail
      mockBatchSend.mockRejectedValue(new Error('Batch service unavailable'))

      // Mock first individual send to succeed, second to fail and Azure also fails
      mockSend
        .mockResolvedValueOnce({
          data: { id: 'email-1' },
          error: null,
        })
        .mockRejectedValueOnce(new Error('Individual send failure'))

      // Mock Azure to fail for the second email (first call succeeds, but second fails)
      mockAzurePollUntilDone.mockResolvedValue({
        status: 'Failed',
        id: 'failed-id',
      })

      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(false)
      expect(result.message).toBe('1/2 emails sent successfully')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].success).toBe(true)
      expect(result.results[1].success).toBe(false)
    })
  })
})
