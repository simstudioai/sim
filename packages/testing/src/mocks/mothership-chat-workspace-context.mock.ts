import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/chat/application/workspace-context`.
 * Both are bare: the workspace a discovery call returns is the behavior callers branch on,
 * so set it (or a rejection) per test.
 *
 * @example
 * ```ts
 * import { mothershipChatWorkspaceContextMockFns } from '@sim/testing/mocks/mothership-chat-workspace-context.mock'
 *
 * mothershipChatWorkspaceContextMockFns.mockReadWorkspaceContextExecute.mockResolvedValue({
 *   success: true,
 *   workspaces: [{ id: 'ws-1', name: 'Sales', role: 'write' }],
 *   nextCursor: null,
 * })
 * ```
 */
export const mothershipChatWorkspaceContextMockFns = {
  mockReadWorkspaceContextAuthorize: vi.fn(),
  mockReadWorkspaceContextExecute: vi.fn(),
}

const readWorkspaceContextOperation = {
  id: 'mothership.chats.workspace_context',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
}

/**
 * Static mock module for `@/lib/mothership/chat/application/workspace-context`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat/application/workspace-context', () => mothershipChatWorkspaceContextMock)
 * ```
 */
export const mothershipChatWorkspaceContextMock = {
  readWorkspaceContextOperation,
  readWorkspaceContext: {
    operation: readWorkspaceContextOperation,
    authorize: mothershipChatWorkspaceContextMockFns.mockReadWorkspaceContextAuthorize,
    execute: mothershipChatWorkspaceContextMockFns.mockReadWorkspaceContextExecute,
  },
}
