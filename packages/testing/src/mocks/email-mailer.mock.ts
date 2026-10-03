import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/messaging/email/mailer`. Every function is a bare
 * `vi.fn()` (returns `undefined`); set `hasEmailService` / `sendEmail` results per test.
 *
 * @example
 * ```ts
 * import { emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
 *
 * emailMailerMockFns.mockSendEmail.mockResolvedValue({ success: true, message: 'sent' })
 * ```
 */
export const emailMailerMockFns = {
  mockHasEmailService: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendBatchEmails: vi.fn(),
}

/**
 * Static mock module for `@/lib/messaging/email/mailer`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
 * ```
 */
export const emailMailerMock = {
  hasEmailService: emailMailerMockFns.mockHasEmailService,
  sendEmail: emailMailerMockFns.mockSendEmail,
  sendBatchEmails: emailMailerMockFns.mockSendBatchEmails,
}
