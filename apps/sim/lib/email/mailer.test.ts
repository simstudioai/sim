import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockSend = vi.fn()

vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: (...args: any[]) => mockSend(...args),
      },
    })),
  }
})

vi.mock('./unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
}))

vi.mock('../env', () => ({
  env: {
    RESEND_API_KEY: 'test-api-key',
    NEXT_PUBLIC_APP_URL: 'https://test.simstudio.ai',
  },
}))

vi.mock('../urls/utils', () => ({
  getEmailDomain: vi.fn().mockReturnValue('simstudio.ai'),
}))

import { type EmailType, sendEmail } from './mailer'
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
  })

  describe('sendEmail', () => {
    it('should send a transactional email successfully', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully')
      expect(result.data).toEqual({ id: 'test-email-id' })

      // Should not check unsubscribe status for transactional emails
      expect(isUnsubscribed).not.toHaveBeenCalled()

      // Should call Resend with correct parameters
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Sim Studio <noreply@simstudio.ai>',
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
        from: 'Sim Studio <noreply@simstudio.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: '<p>Test content</p><a href="mock-token-123">Unsubscribe</a>',
        headers: {
          'List-Unsubscribe':
            '<https://test.simstudio.ai/unsubscribe?token=mock-token-123&email=test%40example.com>',
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

    it('should handle Resend API errors', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API rate limit exceeded' },
      })

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(false)
      expect(result.message).toBe('API rate limit exceeded')
    })

    it('should handle unexpected errors', async () => {
      mockSend.mockRejectedValue(new Error('Network error'))

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(false)
      expect(result.message).toBe('Failed to send email')
    })

    it('should use custom from address when provided', async () => {
      await sendEmail({
        ...testEmailOptions,
        from: 'custom@example.com',
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Sim Studio <custom@example.com>',
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

    it('should replace unsubscribe token placeholders in HTML', async () => {
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
})
