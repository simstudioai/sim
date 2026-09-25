import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/chat-status`.
 *
 * Every function is a bare `vi.fn()` except `mockOnStatusChanged`, which returns a no-op
 * unsubscribe (the real `channel.subscribe` contract).
 *
 * @example
 * ```ts
 * import { mothershipChatStatusMockFns } from '@sim/testing/mocks/mothership-chat-status.mock'
 *
 * expect(mothershipChatStatusMockFns.mockPublishChatStatusChanged).toHaveBeenCalledWith(
 *   { workspaceId: 'ws-1' },
 *   { chatId: 'chat-1', type: 'deleted' }
 * )
 * ```
 */
export const mothershipChatStatusMockFns = {
  mockPublishChatStatusChanged: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockOnStatusChanged: vi.fn((_handler: (event: unknown) => void): (() => void) => () => {}),
  mockDispose: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/chat-status`. `chatPubSub` is the non-null
 * (Redis/EventEmitter available) adapter whose methods are the fns above.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)
 * ```
 */
export const mothershipChatStatusMock = {
  chatPubSub: {
    publishStatusChanged: mothershipChatStatusMockFns.mockPublishStatusChanged,
    onStatusChanged: mothershipChatStatusMockFns.mockOnStatusChanged,
    dispose: mothershipChatStatusMockFns.mockDispose,
  },
  publishChatStatusChanged: mothershipChatStatusMockFns.mockPublishChatStatusChanged,
}
