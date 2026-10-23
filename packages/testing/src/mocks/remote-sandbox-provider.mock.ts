import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/execution/remote-sandbox/provider`.
 *
 * Default: `mockResolveProvider` returns a fresh `{ id: 'e2b' }` — the provider id every local
 * stub agreed on, with no adapter methods. Give it the methods a test exercises
 * (`create`, `findSessionSandbox`, `resolveLifetimeMs`, `dependencyStrategy`, `images`).
 *
 * @example
 * ```ts
 * import { remoteSandboxProviderMockFns } from '@sim/testing/mocks/remote-sandbox-provider.mock'
 *
 * remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
 *   id: 'e2b',
 *   findSessionSandbox: mockFind,
 * })
 * ```
 */
export const remoteSandboxProviderMockFns = {
  mockResolveProvider: vi.fn((): Record<string, unknown> => ({ id: 'e2b' })),
}

/**
 * Static mock module for `@/lib/execution/remote-sandbox/provider`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
 * ```
 */
export const remoteSandboxProviderMock = {
  resolveProvider: remoteSandboxProviderMockFns.mockResolveProvider,
}
