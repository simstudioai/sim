import { beforeEach, describe, expect, test } from 'vitest'
import { EnhancedExecutionLogger } from '@/lib/logs/enhanced-execution-logger'

describe('EnhancedExecutionLogger', () => {
  let logger: EnhancedExecutionLogger

  beforeEach(() => {
    logger = new EnhancedExecutionLogger()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(EnhancedExecutionLogger)
    })
  })

  describe('getTriggerPrefix', () => {
    test('should return correct prefixes for trigger types', () => {
      // Access the private method for testing
      const getTriggerPrefix = (logger as any).getTriggerPrefix.bind(logger)

      expect(getTriggerPrefix('api')).toBe('API')
      expect(getTriggerPrefix('webhook')).toBe('Webhook')
      expect(getTriggerPrefix('schedule')).toBe('Scheduled')
      expect(getTriggerPrefix('manual')).toBe('Manual')
      expect(getTriggerPrefix('chat')).toBe('Chat')
      expect(getTriggerPrefix('unknown' as any)).toBe('Unknown')
    })
  })

  // Note: Database integration tests would require proper mocking setup
  // For now, we're testing the basic functionality without database calls
})
