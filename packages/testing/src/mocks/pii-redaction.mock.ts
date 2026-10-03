import { vi } from 'vitest'

/**
 * Mirrors `PiiRedactionError` from `@/lib/logs/execution/pii-redaction`: same `name` and single
 * `message` constructor argument. The real class extends plain `Error`, so `instanceof` against
 * the mocked export behaves like production.
 */
export class MockPiiRedactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PiiRedactionError'
  }
}

/**
 * Controllable mock functions for `@/lib/logs/execution/pii-redaction`.
 *
 * Defaults: `mockRedactObjectStrings` resolves its input unchanged (redaction is a no-op);
 * `mockRedactPIIFromExecution` is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { piiRedactionMockFns } from '@sim/testing/mocks/pii-redaction.mock'
 *
 * piiRedactionMockFns.mockRedactObjectStrings.mockRejectedValueOnce(new Error('presidio down'))
 * ```
 */
export const piiRedactionMockFns = {
  mockRedactObjectStrings: vi.fn(async <T>(value: T, _options?: unknown): Promise<T> => value),
  mockRedactPIIFromExecution: vi.fn(),
}

/**
 * Static mock module for `@/lib/logs/execution/pii-redaction`. `REDACTION_FAILED_MARKER` carries
 * the real value; `PiiRedactionError` is {@link MockPiiRedactionError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/logs/execution/pii-redaction', () => piiRedactionMock)
 * ```
 */
export const piiRedactionMock = {
  REDACTION_FAILED_MARKER: '[REDACTION_FAILED]',
  PiiRedactionError: MockPiiRedactionError,
  redactObjectStrings: piiRedactionMockFns.mockRedactObjectStrings,
  redactPIIFromExecution: piiRedactionMockFns.mockRedactPIIFromExecution,
}
