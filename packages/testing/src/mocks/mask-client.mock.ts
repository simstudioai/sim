import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/guardrails/mask-client`.
 *
 * Default: `mockMaskPIIBatchViaHttp` resolves every string unchanged with nothing scrubbed.
 *
 * @example
 * ```ts
 * import { maskClientMockFns } from '@sim/testing/mocks/mask-client.mock'
 *
 * maskClientMockFns.mockMaskPIIBatchViaHttp.mockImplementation(async (texts: string[]) => ({
 *   masked: texts.map((text) => `MASKED(${text})`),
 *   scrubbedCount: 0,
 * }))
 * ```
 */
export const maskClientMockFns = {
  mockMaskPIIBatchViaHttp: vi.fn(async (texts: string[], ..._rest: unknown[]) => ({
    masked: texts,
    scrubbedCount: 0,
  })),
}

/**
 * Static mock module for `@/lib/guardrails/mask-client`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/guardrails/mask-client', () => maskClientMock)
 * ```
 */
export const maskClientMock = {
  maskPIIBatchViaHttp: maskClientMockFns.mockMaskPIIBatchViaHttp,
}
