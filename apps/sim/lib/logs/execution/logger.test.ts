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
})
