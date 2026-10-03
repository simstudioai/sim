import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mcp/pubsub`.
 *
 * `publish*` and `mockDispose` are bare no-ops; `mockOnToolsChanged` and
 * `mockOnWorkflowToolsChanged` return a no-op unsubscribe (the real `channel.subscribe` contract).
 *
 * @example
 * ```ts
 * import { mcpPubsubMockFns } from '@sim/testing/mocks/mcp-pubsub.mock'
 *
 * expect(mcpPubsubMockFns.mockPublishWorkflowToolsChanged).toHaveBeenCalledWith({
 *   serverId: 'server-1',
 *   workspaceId: 'ws-1',
 * })
 * ```
 */
export const mcpPubsubMockFns = {
  mockPublishToolsChanged: vi.fn(),
  mockPublishWorkflowToolsChanged: vi.fn(),
  mockOnToolsChanged: vi.fn((_handler: (event: unknown) => void): (() => void) => () => {}),
  mockOnWorkflowToolsChanged: vi.fn((_handler: (event: unknown) => void): (() => void) => () => {}),
  mockDispose: vi.fn(),
}

/**
 * Static mock module for `@/lib/mcp/pubsub`. `mcpPubSub` is the non-null (server-side) adapter
 * whose methods are the fns above. Tests that need the `null` adapter (no Redis, browser) keep a
 * local `{ mcpPubSub: null }` factory.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
 * ```
 */
export const mcpPubsubMock = {
  mcpPubSub: {
    publishToolsChanged: mcpPubsubMockFns.mockPublishToolsChanged,
    publishWorkflowToolsChanged: mcpPubsubMockFns.mockPublishWorkflowToolsChanged,
    onToolsChanged: mcpPubsubMockFns.mockOnToolsChanged,
    onWorkflowToolsChanged: mcpPubsubMockFns.mockOnWorkflowToolsChanged,
    dispose: mcpPubsubMockFns.mockDispose,
  },
}
