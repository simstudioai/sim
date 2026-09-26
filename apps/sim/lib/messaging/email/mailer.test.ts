import { resetEnvMock } from '@sim/testing/mocks/env.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

await vi.hoisted(async () => {
  const { setEnv } = await import('@sim/testing/mocks/env.mock')
  setEnv({
    RESEND_API_KEY: 'test-api-key',
    AZURE_ACS_CONNECTION_STRING: 'test-azure-connection-string',
    AZURE_COMMUNICATION_EMAIL_DOMAIN: 'test.azurecomm.net',
    NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
    FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
  })
})

const mockSend = vi.fn()
const mockBatchSend = vi.fn()
const mockAzureBeginSend = vi.fn()
const mockAzurePollUntilDone = vi.fn()

vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(
      class {
        emails = {
          send: (...args: any[]) => mockSend(...args),
        }
        batch = {
          send: (...args: any[]) => mockBatchSend(...args),
        }
      }
    ),
  }
})

vi.mock('@azure/communication-email', () => {
  return {
    EmailClient: vi.fn().mockImplementation(
      class {
        beginSend = (...args: any[]) => mockAzureBeginSend(...args)
      }
    ),
  }
})

vi.mock('@/lib/messaging/email/unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
}))

vi.mock('@/lib/auth/access-control', () => ({
  getAccessControlConfig: vi.fn().mockResolvedValue({
    blockedSignupDomains: [],
    blockedEmails: [],
    allowedLoginEmails: [],
    allowedLoginDomains: [],
    blockedEmailMxHosts: [],
  }),
  isEmailBlockedByAccessControl: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn().mockReturnValue('Sim <noreply@sim.ai>'),
  hasEmailHeaderControlChars: vi.fn().mockImplementation((value: string) => /[\r\n]/.test(value)),
  EMAIL_HEADER_CONTROL_CHARS_REGEX: /[\r\n]/,
  NO_EMAIL_HEADER_CONTROL_CHARS_REGEX: /^[^\r\n]*$/,
}))

import { isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { sendEmail } from './mailer'
import { generateUnsubscribeToken, isUnsubscribed } from './unsubscribe'

urlsMockFns.mockGetEmailDomain.mockReturnValue('sim.ai')
urlsMockFns.mockGetBaseUrl.mockReturnValue('https://test.sim.ai')
urlsMockFns.mockGetBaseDomain.mockReturnValue('test.sim.ai')
afterAll(() => {
  resetUrlsMock()
  resetEnvMock()
})

describe('mailer', () => {
  const testEmailOptions = {
    to: 'test@example.com',
    subject: 'Test Subject',
    html: '<p>Test email content</p>',
  }

  beforeEach(() => {
    ;(isEmailBlockedByAccessControl as Mock).mockReturnValue(false)
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

  describe('sendEmail', () => {
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

    it('should skip sending when the recipient is on the ban list', async () => {
      ;(isEmailBlockedByAccessControl as Mock).mockReturnValue(true)

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email skipped (recipient on access-control ban list)')
      expect(result.data).toEqual({ id: 'skipped-banned' })
      expect(mockSend).not.toHaveBeenCalled()
      expect(isUnsubscribed).not.toHaveBeenCalled()
    })

    it('should drop only the banned recipients from a multi-recipient send', async () => {
      ;(isEmailBlockedByAccessControl as Mock).mockImplementation(
        (email: string) => email === 'banned@example.com'
      )

      const result = await sendEmail({
        ...testEmailOptions,
        to: ['good@example.com', 'banned@example.com'],
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'good@example.com' }))
    })
  })
})
