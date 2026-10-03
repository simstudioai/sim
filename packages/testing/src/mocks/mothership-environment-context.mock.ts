import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/environment-context`.
 *
 * Both builders resolve `{ resolvedSecretTraceRegistry: {} }` — a context with an empty
 * (stub) secret-trace registry, the shape callers thread into tool execution.
 *
 * @example
 * ```ts
 * import { mothershipEnvironmentContextMockFns } from '@sim/testing/mocks/mothership-environment-context.mock'
 *
 * expect(mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext).toHaveBeenCalledWith(
 *   'user-1',
 *   'ws-1'
 * )
 * ```
 */
export const mothershipEnvironmentContextMockFns = {
  mockCreateCopilotEnvironmentContext: vi.fn(
    async (..._args: unknown[]): Promise<{ resolvedSecretTraceRegistry: unknown }> => ({
      resolvedSecretTraceRegistry: {},
    })
  ),
  mockPrepareCopilotEnvironmentContext: vi.fn(
    async (..._args: unknown[]): Promise<{ resolvedSecretTraceRegistry: unknown }> => ({
      resolvedSecretTraceRegistry: {},
    })
  ),
}

/**
 * Static mock module for `@/lib/mothership/environment-context`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)
 * ```
 */
export const mothershipEnvironmentContextMock = {
  createCopilotEnvironmentContext:
    mothershipEnvironmentContextMockFns.mockCreateCopilotEnvironmentContext,
  prepareCopilotEnvironmentContext:
    mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext,
}
