import { vi } from 'vitest'

/**
 * Creates a mock logger that captures all log calls.
 *
 * @example
 * ```ts
 * const logger = createMockLogger()
 * // Use in your code
 * logger.info('test message')
 * // Assert
 * expect(logger.info).toHaveBeenCalledWith('test message')
 * ```
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  }
}

/**
 * Mock module for @sim/logger.
 * Use with vi.mock() to replace the real logger.
 *
 * @example
 * ```ts
 * vi.mock('@sim/logger', () => loggerMock)
 * ```
 */
export const loggerMock = {
  createLogger: vi.fn(() => createMockLogger()),
  logger: createMockLogger(),
}

/**
 * Returns the mock logger calls for assertion.
 */
export function getLoggerCalls(logger: ReturnType<typeof createMockLogger>) {
  return {
    info: logger.info.mock.calls,
    warn: logger.warn.mock.calls,
    error: logger.error.mock.calls,
    debug: logger.debug.mock.calls,
  }
}

/**
 * Clears all logger mock calls.
 */
export function clearLoggerMocks(logger: ReturnType<typeof createMockLogger>) {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
  logger.debug.mockClear()
  logger.trace.mockClear()
  logger.fatal.mockClear()
}
