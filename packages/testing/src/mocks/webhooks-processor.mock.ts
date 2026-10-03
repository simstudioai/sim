import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/webhooks/processor`.
 * Every function is a bare `vi.fn()` (returns/resolves `undefined`) — configure per-test.
 *
 * @example
 * ```ts
 * import { webhooksProcessorMockFns } from '@sim/testing/mocks/webhooks-processor.mock'
 *
 * webhooksProcessorMockFns.mockFindWebhooksByRoutingKey.mockResolvedValue([])
 * ```
 */
export const webhooksProcessorMockFns = {
  mockParseWebhookBody: vi.fn(),
  mockHandleProviderChallenges: vi.fn(),
  mockHandlePreLookupWebhookVerification: vi.fn(),
  mockHandleProviderReachabilityTest: vi.fn(),
  mockFormatProviderErrorResponse: vi.fn(),
  mockShouldSkipWebhookEvent: vi.fn(),
  mockHandleWebhookEventFilter: vi.fn(),
  mockHandlePreDeploymentVerification: vi.fn(),
  mockFindAllWebhooksForPath: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockVerifyProviderAuth: vi.fn(),
  mockCheckWebhookPreprocessing: vi.fn(),
  mockDispatchResolvedWebhookTarget: vi.fn(),
  mockProcessPolledWebhookEvent: vi.fn(),
}

/**
 * Static mock module for `@/lib/webhooks/processor`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/webhooks/processor', () => webhooksProcessorMock)
 * ```
 */
export const webhooksProcessorMock = {
  parseWebhookBody: webhooksProcessorMockFns.mockParseWebhookBody,
  handleProviderChallenges: webhooksProcessorMockFns.mockHandleProviderChallenges,
  handlePreLookupWebhookVerification:
    webhooksProcessorMockFns.mockHandlePreLookupWebhookVerification,
  handleProviderReachabilityTest: webhooksProcessorMockFns.mockHandleProviderReachabilityTest,
  formatProviderErrorResponse: webhooksProcessorMockFns.mockFormatProviderErrorResponse,
  shouldSkipWebhookEvent: webhooksProcessorMockFns.mockShouldSkipWebhookEvent,
  handleWebhookEventFilter: webhooksProcessorMockFns.mockHandleWebhookEventFilter,
  handlePreDeploymentVerification: webhooksProcessorMockFns.mockHandlePreDeploymentVerification,
  findAllWebhooksForPath: webhooksProcessorMockFns.mockFindAllWebhooksForPath,
  findWebhooksByRoutingKey: webhooksProcessorMockFns.mockFindWebhooksByRoutingKey,
  verifyProviderAuth: webhooksProcessorMockFns.mockVerifyProviderAuth,
  checkWebhookPreprocessing: webhooksProcessorMockFns.mockCheckWebhookPreprocessing,
  dispatchResolvedWebhookTarget: webhooksProcessorMockFns.mockDispatchResolvedWebhookTarget,
  processPolledWebhookEvent: webhooksProcessorMockFns.mockProcessPolledWebhookEvent,
}
