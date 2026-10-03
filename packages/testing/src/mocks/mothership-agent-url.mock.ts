import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/server/agent-url`.
 *
 * Defaults: `mockGetMothershipBaseURL` resolves the real production default
 * `'https://www.copilot.sim.ai'` (the result for any non-superuser), and
 * `mockGetMothershipSourceEnvHeaders` returns `{}` (the result when `COPILOT_SOURCE_ENV` is unset).
 * The superuser-gate cache helpers are no-ops.
 *
 * @example
 * ```ts
 * import { mothershipAgentUrlMockFns } from '@sim/testing/mocks/mothership-agent-url.mock'
 *
 * mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://copilot.test')
 * ```
 */
export const mothershipAgentUrlMockFns = {
  mockInvalidateSuperUserGate: vi.fn((_userId: string): void => {}),
  mockClearSuperUserGate: vi.fn((): void => {}),
  mockGetMothershipBaseURL: vi.fn(
    async (_options?: unknown): Promise<string> => 'https://www.copilot.sim.ai'
  ),
  mockGetMothershipSourceEnvHeaders: vi.fn((): Record<string, string> => ({})),
}

/**
 * Static mock module for `@/lib/mothership/server/agent-url`. `MOTHERSHIP_SOURCE_ENV_HEADER`
 * carries the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
 * ```
 */
export const mothershipAgentUrlMock = {
  MOTHERSHIP_SOURCE_ENV_HEADER: 'X-Sim-Source-Env',
  invalidateSuperUserGate: mothershipAgentUrlMockFns.mockInvalidateSuperUserGate,
  clearSuperUserGate: mothershipAgentUrlMockFns.mockClearSuperUserGate,
  getMothershipBaseURL: mothershipAgentUrlMockFns.mockGetMothershipBaseURL,
  getMothershipSourceEnvHeaders: mothershipAgentUrlMockFns.mockGetMothershipSourceEnvHeaders,
}
