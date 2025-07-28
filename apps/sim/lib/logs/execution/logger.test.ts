import { beforeEach, describe, expect, test } from 'vitest'
import { ExecutionLogger } from '@/lib/logs/execution/logger'

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger

  beforeEach(() => {
    logger = new ExecutionLogger()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(ExecutionLogger)
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
})
