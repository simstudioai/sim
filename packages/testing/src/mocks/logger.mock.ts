import { vi } from 'vitest'

/** A logger whose every method is a `vi.fn()`. */
export interface MockLogger {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  trace: ReturnType<typeof vi.fn>
  fatal: ReturnType<typeof vi.fn>
  child: ReturnType<typeof vi.fn>
  withMetadata: ReturnType<typeof vi.fn>
}

/**
 * Creates a mock logger that captures all log calls. `child()` and
 * `withMetadata()` return the same logger, so calls made through a scoped
 * logger are asserted on the instance the test already holds.
 *
 * @example
 * ```ts
 * const logger = createMockLogger()
 * logger.withMetadata({ requestId: 'r1' }).warn('slow')
 * expect(logger.warn).toHaveBeenCalledWith('slow')
 * ```
 */
export function createMockLogger(): MockLogger {
  const logger: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    withMetadata: vi.fn(() => logger),
  }
  return logger
}

const loggersByName = new Map<string, MockLogger>()

/**
 * The logger the global `@sim/logger` mock hands to `createLogger(name)`.
 * One instance per name for the life of the test file, so a test can assert on
 * the logger a module under test created without re-mocking `@sim/logger`.
 * Call history is cleared between tests by Vitest's `clearMocks`.
 *
 * @example
 * ```ts
 * import { getMockLogger } from '@sim/testing/mocks/logger.mock'
 *
 * await runSync()
 * expect(getMockLogger('ConnectorSync').warn).toHaveBeenCalledWith(
 *   expect.stringContaining('retrying')
 * )
 * ```
 */
export function getMockLogger(name: string): MockLogger {
  let logger = loggersByName.get(name)
  if (!logger) {
    logger = createMockLogger()
    loggersByName.set(name, logger)
  }
  return logger
}

/**
 * Every logger created through the global `@sim/logger` mock so far in this test file. Use it to
 * assert that no module logged something, e.g. that no error log leaks a secret.
 */
export function getAllMockLoggers(): MockLogger[] {
  return [...loggersByName.values()]
}

/**
 * Mock module for `@sim/logger`, installed globally by `apps/sim/vitest.setup.ts`.
 * `createLogger(name)` returns {@link getMockLogger}`(name)`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/logger', () => loggerMock)
 * ```
 */
export const loggerMock = {
  createLogger: vi.fn((name: string) => getMockLogger(name)),
  logger: createMockLogger(),
  runWithRequestContext: vi.fn(<T>(_ctx: unknown, fn: () => T): T => fn()),
  getRequestContext: vi.fn(() => undefined),
  setRequestTraceId: vi.fn(),
  setRequestAuth: vi.fn(),
}
