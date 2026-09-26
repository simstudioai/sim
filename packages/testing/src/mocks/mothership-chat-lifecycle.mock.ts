import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/chat/lifecycle`. Every loader is a bare
 * `vi.fn()`: set the chat row (or `null` for "not found / not accessible") per test.
 *
 * @example
 * ```ts
 * import { mothershipChatLifecycleMockFns } from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
 *
 * mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth.mockResolvedValue(null)
 * ```
 */
export const mothershipChatLifecycleMockFns = {
  mockLoadCopilotChatMessages: vi.fn(),
  mockGetAccessibleCopilotChatAuth: vi.fn(),
  mockGetAccessibleCopilotChatForCancellation: vi.fn(),
  mockGetAccessibleCopilotChat: vi.fn(),
  mockGetAccessibleCopilotChatWithMessages: vi.fn(),
  mockResolveOrCreateChat: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/chat/lifecycle`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)
 * ```
 */
export const mothershipChatLifecycleMock = {
  loadCopilotChatMessages: mothershipChatLifecycleMockFns.mockLoadCopilotChatMessages,
  getAccessibleCopilotChatAuth: mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth,
  getAccessibleCopilotChatForCancellation:
    mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatForCancellation,
  getAccessibleCopilotChat: mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChat,
  getAccessibleCopilotChatWithMessages:
    mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatWithMessages,
  resolveOrCreateChat: mothershipChatLifecycleMockFns.mockResolveOrCreateChat,
}
