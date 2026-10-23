import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/messaging/email/unsubscribe`. `getEmailPreferences`
 * resolves `null` (no stored preferences, so nobody is unsubscribed); every other function is a
 * bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { emailUnsubscribeMockFns } from '@sim/testing/mocks/email-unsubscribe.mock'
 *
 * emailUnsubscribeMockFns.mockGetEmailPreferences.mockResolvedValue({ unsubscribeAll: true })
 * ```
 */
export const emailUnsubscribeMockFns = {
  mockGenerateUnsubscribeToken: vi.fn(),
  mockVerifyUnsubscribeToken: vi.fn(),
  mockIsTransactionalEmail: vi.fn(),
  mockGetEmailPreferences: vi.fn(async (): Promise<unknown> => null),
  mockUpdateEmailPreferences: vi.fn(),
  mockIsUnsubscribed: vi.fn(),
  mockUnsubscribeFromAll: vi.fn(),
}

/**
 * Static mock module for `@/lib/messaging/email/unsubscribe`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/messaging/email/unsubscribe', () => emailUnsubscribeMock)
 * ```
 */
export const emailUnsubscribeMock = {
  generateUnsubscribeToken: emailUnsubscribeMockFns.mockGenerateUnsubscribeToken,
  verifyUnsubscribeToken: emailUnsubscribeMockFns.mockVerifyUnsubscribeToken,
  isTransactionalEmail: emailUnsubscribeMockFns.mockIsTransactionalEmail,
  getEmailPreferences: emailUnsubscribeMockFns.mockGetEmailPreferences,
  updateEmailPreferences: emailUnsubscribeMockFns.mockUpdateEmailPreferences,
  isUnsubscribed: emailUnsubscribeMockFns.mockIsUnsubscribed,
  unsubscribeFromAll: emailUnsubscribeMockFns.mockUnsubscribeFromAll,
}
