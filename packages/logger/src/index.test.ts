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

  describe('browser suppression in production', () => {
    const realProcess = globalThis.process

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
      globalThis.process = realProcess
    })

    test('should keep logging when the server installs a DOM', () => {
      globalThis.process = {
        ...realProcess,
        env: { ...realProcess.env, NODE_ENV: 'production' },
      } as typeof realProcess
      Object.assign(globalThis, { window: { document: {} } })

      createLogger('Test').error('server still logs')

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    test('should stay silent in a real browser', () => {
      globalThis.process = { env: { NODE_ENV: 'production' } } as unknown as typeof realProcess
      Object.assign(globalThis, { window: { document: {} } })

      createLogger('Test').error('browser stays quiet')

      expect(consoleErrorSpy).not.toHaveBeenCalled()
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

  describe('withMetadata', () => {
    const createEnabledLogger = () =>
      new Logger('Test', { enabled: true, colorize: false, logLevel: LogLevel.DEBUG })

    test('should return a new Logger instance', () => {
      const logger = createEnabledLogger()
      const child = logger.withMetadata({ workflowId: 'wf_1' })
      expect(child).toBeInstanceOf(Logger)
      expect(child).not.toBe(logger)
    })

    test('should include metadata in log output', () => {
      const child = createEnabledLogger().withMetadata({ workflowId: 'wf_1' })
      child.info('hello')
      expect(consoleLogSpy).toHaveBeenCalledTimes(1)
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.workflowId).toBe('wf_1')
      expect(parsed.message).toBe('hello')
    })

    test('should not affect original logger output', () => {
      const logger = createEnabledLogger()
      logger.withMetadata({ workflowId: 'wf_1' })
      logger.info('hello')
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.workflowId).toBeUndefined()
    })

    test('should merge metadata across chained calls', () => {
      const child = createEnabledLogger().withMetadata({ a: '1' }).withMetadata({ b: '2' })
      child.info('hello')
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.a).toBe('1')
      expect(parsed.b).toBe('2')
    })

    test('should override parent metadata for same key', () => {
      const child = createEnabledLogger().withMetadata({ a: '1' }).withMetadata({ a: '2' })
      child.info('hello')
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.a).toBe('2')
    })

    test('should exclude undefined values from output', () => {
      const child = createEnabledLogger().withMetadata({ a: '1', b: undefined })
      child.info('hello')
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.a).toBe('1')
      expect(parsed.b).toBeUndefined()
    })

    test('should produce no metadata segment when metadata is empty', () => {
      const child = createEnabledLogger().withMetadata({})
      child.info('hello')
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(Object.keys(parsed)).toEqual(
        expect.arrayContaining(['timestamp', 'level', 'module', 'message'])
      )
    })
  })

  describe('structured serialization safety', () => {
    const createEnabledLogger = () =>
      new Logger('Test', { enabled: true, colorize: false, logLevel: LogLevel.DEBUG })

    test('should emit a line instead of throwing on cyclic metadata', () => {
      const cyclic: Record<string, unknown> = { id: 'x' }
      cyclic.self = cyclic

      expect(() => createEnabledLogger().info('hello', cyclic)).not.toThrow()
      expect(consoleLogSpy).toHaveBeenCalledTimes(1)
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(parsed.id).toBe('x')
      expect(parsed.self.self).toBe('[Circular]')
    })

    test('should render an Error held under a key as its message, not {}', () => {
      const error = new Error('boom')

      createEnabledLogger().error('failed', { error })

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.error).toBe('boom')
      expect(parsed.stack).toBe(error.stack)
    })

    test('should render an Error under a non-conventional key without hijacking stack', () => {
      createEnabledLogger().error('failed', { cause: new Error('inner'), stack: 'caller-supplied' })

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.cause).toBe('inner')
      expect(parsed.stack).toBe('caller-supplied')
    })

    test('should keep sibling keys alongside an Error value', () => {
      createEnabledLogger().error('failed', { error: new Error('boom'), toolId: 'slack_message' })

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.error).toBe('boom')
      expect(parsed.toolId).toBe('slack_message')
    })

    test('should unwrap an Error held under a key on the colorized path too', () => {
      const colorized = new Logger('Test', {
        enabled: true,
        colorize: true,
        logLevel: LogLevel.DEBUG,
      })

      colorized.error('failed', { error: new Error('boom') })

      const printed = consoleErrorSpy.mock.calls[0].join(' ')
      expect(printed).toContain('boom')
      expect(printed).not.toContain('"error":{}')
    })

    test('should emit a line instead of throwing on BigInt metadata', () => {
      expect(() => createEnabledLogger().error('boom', { size: 10n })).not.toThrow()
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('boom')
      expect(parsed.size).toBe('10')
    })

    test('should fall back to a minimal entry when a value cannot be serialized at all', () => {
      const hostile = {
        get boom() {
          throw new Error('getter exploded')
        },
      }

      expect(() => createEnabledLogger().info('hello', hostile)).not.toThrow()
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(parsed.module).toBe('Test')
      expect(parsed.serializationError).toBe(true)
    })

    test('should not throw when withMetadata receives a throwing getter', () => {
      const hostile = {
        safe: 'kept',
        get boom() {
          throw new Error('getter exploded')
        },
      } as unknown as Parameters<Logger['withMetadata']>[0]

      let child: Logger | undefined
      expect(() => {
        child = createEnabledLogger().withMetadata(hostile)
      }).not.toThrow()

      expect(() => child?.info('hello')).not.toThrow()
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(parsed.safe).toBe('kept')
      expect(parsed.boom).toBe('[Unreadable]')
    })

    test('should keep repeated references that are not cycles', () => {
      const shared = { s: 'REAL_DATA', n: 42 }
      const payload = { p: shared, q: shared, arr: [shared, shared], big: 1n } as unknown as object

      createEnabledLogger().info('hello', payload)

      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.p).toEqual({ s: 'REAL_DATA', n: 42 })
      expect(parsed.q).toEqual({ s: 'REAL_DATA', n: 42 })
      expect(parsed.arr).toEqual([
        { s: 'REAL_DATA', n: 42 },
        { s: 'REAL_DATA', n: 42 },
      ])
      expect(parsed.big).toBe('1')
    })

    test('should still mark a genuine cycle as circular', () => {
      const cyclic: Record<string, unknown> = { name: 'root' }
      cyclic.self = cyclic
      const payload = { cyclic, big: 1n } as unknown as object

      createEnabledLogger().info('hello', payload)

      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.cyclic.name).toBe('root')
      expect(parsed.cyclic.self).toBe('[Circular]')
    })

    test('should not throw when retained metadata has a throwing toJSON', () => {
      const hostile = {
        evil: {
          toJSON() {
            throw new Error('toJSON exploded')
          },
        },
      } as unknown as Parameters<Logger['withMetadata']>[0]

      const child = createEnabledLogger().withMetadata(hostile)

      expect(() => child.info('hello')).not.toThrow()
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(parsed.module).toBe('Test')
      expect(parsed.serializationError).toBe(true)
      expect(parsed.evil).toBeUndefined()
    })

    test('should not throw when withMetadata receives a hostile proxy', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('ownKeys exploded')
          },
        }
      ) as Parameters<Logger['withMetadata']>[0]

      let child: Logger | undefined
      expect(() => {
        child = createEnabledLogger().withMetadata(hostile)
      }).not.toThrow()

      expect(() => child?.info('hello')).not.toThrow()
      const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0] as string)
      expect(parsed.message).toBe('hello')
      expect(parsed.metadataError).toBe(true)
    })
  })
})
