import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.unmock('@/lib/logs/console/logger')

import { createLogger, Logger } from '@/lib/logs/console/logger'

describe('Logger', () => {
  let logger: Logger

  beforeEach(() => {
    logger = new Logger('TestModule')
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(Logger)
    })
  })

  describe('createLogger factory function', () => {
    test('should create logger instance', () => {
      const factoryLogger = createLogger('FactoryModule')
      expect(factoryLogger).toBeDefined()
      expect(factoryLogger).toBeInstanceOf(Logger)
    })
  })

  describe('logging methods', () => {
    test('should have debug method', () => {
      expect(typeof logger.debug).toBe('function')
    })

    test('should have info method', () => {
      expect(typeof logger.info).toBe('function')
    })

    test('should have warn method', () => {
      expect(typeof logger.warn).toBe('function')
    })

    test('should have error method', () => {
      expect(typeof logger.error).toBe('function')
    })
  })
})
