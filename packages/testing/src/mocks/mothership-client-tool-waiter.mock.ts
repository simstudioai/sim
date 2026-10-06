import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/request/tools/client`, the waiters that
 * resolve a client-executed tool call from its confirmation. Each defaults to resolving `null`
 * (no result before the wait ended).
 *
 * @example
 * ```ts
 * import {
 *   mothershipClientToolWaiterMock,
 *   mothershipClientToolWaiterMockFns,
 * } from '@sim/testing/mocks/mothership-client-tool-waiter.mock'
 *
 * vi.mock('@/lib/mothership/request/tools/client', () => mothershipClientToolWaiterMock)
 * mothershipClientToolWaiterMockFns.mockWaitForClientToolCompletion.mockResolvedValueOnce(result)
 * ```
 */
export const mothershipClientToolWaiterMockFns = {
  mockWaitForToolCompletion: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockWaitForClientToolCompletion: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockWaitForWorkflowToolCompletion: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}

/** Static mock module for `@/lib/mothership/request/tools/client`. Covers every runtime export. */
export const mothershipClientToolWaiterMock = {
  waitForToolCompletion: mothershipClientToolWaiterMockFns.mockWaitForToolCompletion,
  waitForClientToolCompletion: mothershipClientToolWaiterMockFns.mockWaitForClientToolCompletion,
  waitForWorkflowToolCompletion:
    mothershipClientToolWaiterMockFns.mockWaitForWorkflowToolCompletion,
}
