import { logs } from '@opentelemetry/api-logs'
import { createLogger, Logger, LogLevel, runWithRequestContext, setRequestAuth } from '@sim/logger'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

  describe('request attribution', () => {
    test('exports authenticated OAuth attribution to both JSON and OpenTelemetry logs', () => {
      const emit = vi.fn()
      const getLoggerSpy = vi
        .spyOn(logs, 'getLogger')
        .mockReturnValue({ emit, enabled: () => true })
      try {
        runWithRequestContext(
          {
            requestId: 'req-oauth',
            client: { surface: 'unknown', source: 'unidentified', name: 'http-client' },
          },
          () => {
            setRequestAuth({ kind: 'oauth_access_token', clientId: 'registered-client' })
            new Logger('Test', { enabled: true, colorize: false, logLevel: LogLevel.INFO }).info(
              'Tool completed'
            )
          }
        )
        const attribution = {
          requestId: 'req-oauth',
          surface: 'api',
          clientName: 'http-client',
          auth: 'oauth_access_token',
          authClientId: 'registered-client',
        }
        expect(JSON.parse(consoleLogSpy.mock.calls[0][0] as string)).toMatchObject(attribution)
        expect(emit).toHaveBeenCalledWith(
          expect.objectContaining({ attributes: expect.objectContaining(attribution) })
        )
      } finally {
        getLoggerSpy.mockRestore()
      }
    })

    test('keeps concurrent callers separate and does not attach OAuth attribution to API keys', async () => {
      const logger = new Logger('Test', { enabled: true, colorize: false, logLevel: LogLevel.INFO })
      await Promise.all(
        ['client-a', 'client-b'].map((clientId) =>
          runWithRequestContext({ requestId: clientId }, async () => {
            setRequestAuth({ kind: 'oauth_access_token', clientId })
            await Promise.resolve()
            logger.info('Tool completed')
          })
        )
      )
      runWithRequestContext({ requestId: 'req-key' }, () => {
        setRequestAuth({ kind: 'personal_api_key' })
        logger.info('Tool completed')
      })
      logger.info('Outside request')

      const records = consoleLogSpy.mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0] as string)
      )
      expect(records.slice(0, 2)).toEqual([
        expect.objectContaining({ requestId: 'client-a', authClientId: 'client-a' }),
        expect.objectContaining({ requestId: 'client-b', authClientId: 'client-b' }),
      ])
      expect(records[2]).toMatchObject({ requestId: 'req-key', auth: 'personal_api_key' })
      expect(records[2]).not.toHaveProperty('authClientId')
      expect(records[3]).not.toHaveProperty('authClientId')
      expect(records[3]).not.toHaveProperty('requestId')
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

  describe('wrapped driver errors', () => {
    const createEnabledLogger = () =>
      new Logger('Test', { enabled: true, colorize: false, logLevel: LogLevel.DEBUG })

    /**
     * Mirrors Drizzle's `DrizzleQueryError`: SQL plus bound values in the message, and `query`,
     * `params` and `cause` as own enumerable properties, wrapping the driver error.
     */
    const queryError = (params: string) => {
      const cause = Object.assign(new Error('canceling statement due to statement timeout'), {
        name: 'PostgresError',
        code: '57014',
        detail: `Key (email)=(${params}) already exists.`,
      })
      const query = 'select "id" from "user_table_rows" where "table_id" = $1 limit $2'
      const error = Object.assign(new Error(`Failed query: ${query}\nparams: ${params}`), {
        query,
        params: params.split(','),
        cause,
      })
      error.name = 'DrizzleQueryError'
      return error
    }

    const consoleOutput = () =>
      [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].flat().join(' ')

    test('names the deepest cause and its code on the line', () => {
      createEnabledLogger().error('Failed to query rows:', { error: queryError('tbl_1,52') })

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.errorCause).toBe('PostgresError: canceling statement due to statement timeout')
      expect(parsed.errorCode).toBe('57014')
    })

    test('reports the cause of the same error the line reports when given two', () => {
      const conflict = Object.assign(new Error('duplicate key value'), {
        name: 'PostgresError',
        code: '23505',
      })
      const second = new Error('Failed query: insert into "t" values ($1)', { cause: conflict })

      createEnabledLogger().error('Retry failed', queryError('tbl_1'), second)

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.error).toBe(second.message)
      expect(parsed.errorCause).toBe('PostgresError: duplicate key value')
      expect(parsed.errorCode).toBe('23505')
    })

    test.each([
      ['an object field', (error: Error) => [{ error }]],
      ['a bare argument', (error: Error) => [error]],
    ])('keeps bound values out of the message and stack when passed as %s', (_, args) => {
      createEnabledLogger().error(
        'Failed to query rows:',
        ...args(queryError('alice@example.com,52'))
      )

      const line = consoleErrorSpy.mock.calls[0][0] as string
      expect(line).not.toContain('alice@example.com')
      const parsed = JSON.parse(line)
      expect(parsed.error).toContain('Failed query: select "id"')
      expect(parsed.error).toContain('params: [redacted]')
      expect(parsed.stack).toContain('params: [redacted]')
      expect(parsed.stack).toMatch(/\n\s+at /)
    })

    test.each([
      ['under another key', (error: Error) => ({ dbError: error })],
      ['nested inside metadata', (error: Error) => ({ details: { attempt: 2, error } })],
    ])('keeps bound values out of an error logged %s', (_, arg) => {
      createEnabledLogger().error('Insert failed', arg(queryError('alice@example.com')))

      expect(consoleOutput()).not.toContain('alice@example.com')
    })

    test.each([
      ['an object field', (error: Error) => [{ error }]],
      ['a bare argument', (error: Error) => [error]],
      ['nested inside metadata', (error: Error) => [{ details: { error } }]],
    ])('keeps bound values out of colorized output when passed as %s', (_, args) => {
      new Logger('Test', { enabled: true, colorize: true, logLevel: LogLevel.DEBUG }).error(
        'Failed to query rows:',
        ...args(queryError('alice@example.com'))
      )

      const output = consoleOutput()
      expect(output).toContain('params: [redacted]')
      expect(output).not.toContain('alice@example.com')
    })

    test.each([
      ['a bare argument', (error: Error) => [error]],
      ['an object field', (error: Error) => [{ error }]],
    ])('keeps bound values out of the exported log record when passed as %s', (_, args) => {
      const emit = vi.fn()
      const getLoggerSpy = vi
        .spyOn(logs, 'getLogger')
        .mockReturnValue({ emit, enabled: () => true })
      try {
        createEnabledLogger().error(
          'Failed to query rows:',
          ...args(queryError('alice@example.com'))
        )

        const { attributes } = emit.mock.calls[0][0]
        expect(JSON.stringify(attributes)).not.toContain('alice@example.com')
        expect(attributes['error.cause']).toBe(
          'PostgresError: canceling statement due to statement timeout'
        )
      } finally {
        getLoggerSpy.mockRestore()
      }
    })

    test('emits a line for a nested error that references itself', () => {
      const error = Object.assign(new Error('self-referencing failure'), {
        context: {} as Record<string, unknown>,
      })
      error.context.error = error

      expect(() => createEnabledLogger().error('Failed', { details: { error } })).not.toThrow()
      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.details.error.message).toBe('self-referencing failure')
      expect(parsed.details.error.context.error).toBe('[Circular]')
    })

    test('leaves an unwrapped error without cause fields', () => {
      createEnabledLogger().error('Request failed', { error: new Error('plain failure') })

      const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
      expect(parsed.error).toBe('plain failure')
      expect(parsed).not.toHaveProperty('errorCause')
    })
  })
})
