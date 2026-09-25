import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/providers/conversation-history`.
 *
 * Defaults model "no conversation capture bound to this request":
 * - `getConversationRequestContext` is a bare `vi.fn()` (returns `undefined`);
 * - `isProviderConversationCaptureEnabled` → `false`;
 * - `captureProviderConversationStep`, `recordProviderConversationUsage` and
 *   `recordProviderConversationToolError` resolve `undefined`;
 * - `bindConversationRequestContext`, `getConfiguredConversationToolBinding` and
 *   `getConversationBinding` are bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { providersConversationHistoryMockFns } from '@sim/testing/mocks/providers-conversation-history.mock'
 *
 * providersConversationHistoryMockFns.mockGetConversationRequestContext.mockReturnValue({
 *   agentConversation: {},
 *   agentMemoryContext: { historyTokens: 0 },
 * })
 * expect(providersConversationHistoryMockFns.mockCaptureProviderConversationStep).toHaveBeenCalled()
 * ```
 */
export const providersConversationHistoryMockFns = {
  mockBindConversationRequestContext: vi.fn(),
  mockGetConversationRequestContext: vi.fn(),
  mockIsProviderConversationCaptureEnabled: vi.fn((_request: unknown): boolean => false),
  mockGetConfiguredConversationToolBinding: vi.fn(),
  mockGetConversationBinding: vi.fn(),
  mockCaptureProviderConversationStep: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockRecordProviderConversationUsage: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockRecordProviderConversationToolError: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
}

/**
 * Static mock module for `@/providers/conversation-history`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
 * ```
 */
export const providersConversationHistoryMock = {
  bindConversationRequestContext:
    providersConversationHistoryMockFns.mockBindConversationRequestContext,
  getConversationRequestContext:
    providersConversationHistoryMockFns.mockGetConversationRequestContext,
  isProviderConversationCaptureEnabled:
    providersConversationHistoryMockFns.mockIsProviderConversationCaptureEnabled,
  getConfiguredConversationToolBinding:
    providersConversationHistoryMockFns.mockGetConfiguredConversationToolBinding,
  getConversationBinding: providersConversationHistoryMockFns.mockGetConversationBinding,
  captureProviderConversationStep:
    providersConversationHistoryMockFns.mockCaptureProviderConversationStep,
  recordProviderConversationUsage:
    providersConversationHistoryMockFns.mockRecordProviderConversationUsage,
  recordProviderConversationToolError:
    providersConversationHistoryMockFns.mockRecordProviderConversationToolError,
}
