import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLogger, Logger, LogLevel } from './index'

/**
 * Tests for the console logger module.
 * Tests the Logger class and createLogger factory function.
 */

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('class instantiation', () => {
    test('should create logger instance with module name', () => {
      const logger = new Logger('TestModule')
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(Logger)
    })
  })

  describe('createLogger factory', () => {
    test('should create logger instance with expected methods', () => {
      const logger = createLogger('MyComponent')
      expect(logger).toBeDefined()
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })

    test('should create multiple independent loggers', () => {
      const logger1 = createLogger('Component1')
      const logger2 = createLogger('Component2')
      expect(logger1).not.toBe(logger2)
    })
  })

  describe('LogLevel enum', () => {
    test('should have correct log levels', () => {
      expect(LogLevel.DEBUG).toBe('DEBUG')
      expect(LogLevel.INFO).toBe('INFO')
      expect(LogLevel.WARN).toBe('WARN')
      expect(LogLevel.ERROR).toBe('ERROR')
    })
  })

  describe('logging methods', () => {
    test('should have debug method', () => {
      const logger = createLogger('TestModule')
      expect(typeof logger.debug).toBe('function')
    })

    test('should have info method', () => {
      const logger = createLogger('TestModule')
      expect(typeof logger.info).toBe('function')
    })

    test('should have warn method', () => {
      const logger = createLogger('TestModule')
      expect(typeof logger.warn).toBe('function')
    })

    test('should have error method', () => {
      const logger = createLogger('TestModule')
      expect(typeof logger.error).toBe('function')
    })
  })

  describe('logging behavior', () => {
    test('should not throw when calling debug', () => {
      const logger = createLogger('TestModule')
      expect(() => logger.debug('Test debug message')).not.toThrow()
    })

    test('should not throw when calling info', () => {
      const logger = createLogger('TestModule')
      expect(() => logger.info('Test info message')).not.toThrow()
    })

    test('should not throw when calling warn', () => {
      const logger = createLogger('TestModule')
      expect(() => logger.warn('Test warn message')).not.toThrow()
    })

    test('should not throw when calling error', () => {
      const logger = createLogger('TestModule')
      expect(() => logger.error('Test error message')).not.toThrow()
    })
  })

  describe('object formatting', () => {
    test('should handle null and undefined arguments', () => {
      const logger = createLogger('TestModule')

      expect(() => {
        logger.info('Message with null:', null)
        logger.info('Message with undefined:', undefined)
      }).not.toThrow()
    })

    test('should handle object arguments', () => {
      const logger = createLogger('TestModule')
      const testObj = { key: 'value', nested: { data: 123 } }

      expect(() => {
        logger.info('Message with object:', testObj)
      }).not.toThrow()
    })

    test('should handle Error objects', () => {
      const logger = createLogger('TestModule')
      const testError = new Error('Test error message')

      expect(() => {
        logger.error('An error occurred:', testError)
      }).not.toThrow()
    })

    test('should handle circular references gracefully', () => {
      const logger = createLogger('TestModule')
      const circularObj: Record<string, unknown> = { name: 'test' }
      circularObj.self = circularObj

      expect(() => {
        logger.info('Circular object:', circularObj)
      }).not.toThrow()
    })

    test('should handle arrays', () => {
      const logger = createLogger('TestModule')
      const testArray = [1, 2, 3, { nested: true }]

      expect(() => {
        logger.info('Array data:', testArray)
      }).not.toThrow()
    })

    test('should handle multiple arguments', () => {
      const logger = createLogger('TestModule')

      expect(() => {
        logger.debug('Multiple args:', 'string', 123, { obj: true }, ['array'])
      }).not.toThrow()
    })
  })
})
