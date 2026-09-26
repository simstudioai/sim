import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/chat/messages-store`. Both writers
 * resolve `undefined` (the real `Promise<void>` success result).
 *
 * @example
 * ```ts
 * import { mothershipChatMessagesMockFns } from '@sim/testing/mocks/mothership-chat-messages.mock'
 *
 * expect(mothershipChatMessagesMockFns.mockAppendCopilotChatMessages).toHaveBeenCalledWith(
 *   'chat-1',
 *   expect.any(Array)
 * )
 * ```
 */
export const mothershipChatMessagesMockFns = {
  mockAppendCopilotChatMessages: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockPersistCopilotChatTurn: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
}

/**
 * Static mock module for `@/lib/mothership/chat/messages-store`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat/messages-store', () => mothershipChatMessagesMock)
 * ```
 */
export const mothershipChatMessagesMock = {
  appendCopilotChatMessages: mothershipChatMessagesMockFns.mockAppendCopilotChatMessages,
  persistCopilotChatTurn: mothershipChatMessagesMockFns.mockPersistCopilotChatTurn,
}
