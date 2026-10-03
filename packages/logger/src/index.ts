/**
 * @sim/logger
 *
 * Framework-agnostic logging utilities for the Sim platform.
 * Provides standardized console logging with environment-aware configuration.
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { describeError, redactBoundParameters } from '@sim/utils/errors'
import { filterUndefined, isRecordLike } from '@sim/utils/object'
import chalk from 'chalk'
import { getRequestContext, type RequestContext } from './request-context'

/**
 * LogLevel enum defines the severity levels for logging
 *
 * DEBUG: Detailed information, typically useful only for diagnosing problems
 * INFO: Confirmation that things are working as expected
 * WARN: Indication that something unexpected happened
 * ERROR: Error events that might still allow the application to continue running
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to display */
  logLevel?: LogLevel | string
  /** Whether to colorize output */
  colorize?: boolean
  /** Whether logging is enabled */
  enabled?: boolean
}

/**
 * Metadata key-value pairs attached to a logger instance.
 * Included automatically in every log line produced by that logger.
 */
export type LoggerMetadata = Record<string, string | number | boolean | undefined>

const getNodeEnv = (): string => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV || 'development'
  }
  return 'development'
}

/**
 * True only in a real browser.
 *
 * Server code can legitimately install a DOM — `ensureDomForTipTap` in the
 * collab-doc converter mounts a jsdom `window` so TipTap runs headless — so the
 * presence of `window` alone does not mean the browser. Node always exposes
 * `process.versions.node` and a browser never does, which keeps a server-side
 * DOM from silencing the logger for the rest of the process's life.
 */
const isBrowserRuntime = (): boolean => {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') return false
  const runtime = (globalThis as { process?: { versions?: { node?: unknown } } }).process
  return typeof runtime?.versions?.node !== 'string'
}

const getLogLevel = (): string | undefined => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.LOG_LEVEL
  }
  return undefined
}

/**
 * Get the minimum log level from environment variable or use defaults
 * - Development: DEBUG (show all logs)
 * - Production: ERROR (only show errors, but can be overridden by LOG_LEVEL env var)
 * - Test: ERROR (only show errors in tests)
 */
const getMinLogLevel = (): LogLevel => {
  const logLevelEnv = getLogLevel()
  if (logLevelEnv && Object.values(LogLevel).includes(logLevelEnv as LogLevel)) {
    return logLevelEnv as LogLevel
  }

  const nodeEnv = getNodeEnv()
  switch (nodeEnv) {
    case 'development':
      return LogLevel.DEBUG
    case 'production':
      return LogLevel.ERROR
    case 'test':
      return LogLevel.ERROR
    default:
      return LogLevel.DEBUG
  }
}

/**
 * Configuration for different environments
 */
const getLogConfig = () => {
  const nodeEnv = getNodeEnv()
  const minLevel = getMinLogLevel()

  switch (nodeEnv) {
    case 'development':
      return {
        enabled: true,
        minLevel,
        colorize: true,
      }
    case 'production':
      return {
        enabled: true,
        minLevel,
        colorize: false,
      }
    case 'test':
      return {
        enabled: false,
        minLevel,
        colorize: false,
      }
    default:
      return {
        enabled: true,
        minLevel,
        colorize: true,
      }
  }
}

interface LoggedError {
  message: string
  stack?: string
  /** `"Name: message"` of the deepest `.cause` link, present only when the error wraps another. */
  cause?: string
  code?: string
  /** Whether the message carried a bound-parameter tail, marking the error as a query wrapper. */
  redacted: boolean
}

/**
 * The fields a log line keeps for an error.
 *
 * Drizzle's `DrizzleQueryError` appends `\nparams: <values>` — user data — to
 * its message, and the stack repeats the message, so both are redacted. The
 * wrapper's message is only the failing SQL; the reason (a statement timeout, a
 * constraint violation) lives on the driver error in `.cause`, which no field
 * would otherwise carry.
 */
const toLoggedError = (error: Error): LoggedError => {
  const message = redactBoundParameters(error.message)
  const stack =
    error.stack === undefined || message === error.message
      ? error.stack
      : error.stack.includes(error.message)
        ? error.stack.replace(error.message, () => message)
        : redactBoundParameters(error.stack)
  const described = describeError(error)
  return {
    message,
    stack,
    ...(described.causeChain ? { cause: `${described.name}: ${described.message}` } : {}),
    ...(described.code ? { code: described.code } : {}),
    redacted: message !== error.message,
  }
}

/**
 * Renders an error as the plain object `JSON.stringify` cannot produce for it.
 *
 * `message`, `stack` and `name` are non-enumerable on `Error.prototype`, so a
 * plain stringify emits `{}` — or, for an error with own enumerable properties,
 * only those. Own properties are copied because driver and HTTP errors carry the
 * useful part (`code`, `status`) there, except what `toLoggedError` replaces: a
 * query wrapper's `params` holds the redacted values, and a summarized `cause`
 * would carry the driver's `detail`.
 */
const toPlainError = (error: Error, includeStack: boolean): Record<string, unknown> => {
  const logged = toLoggedError(error)
  const plain: Record<string, unknown> = {
    message: logged.message,
    stack: includeStack ? logged.stack : undefined,
    name: error.name,
    ...(logged.cause ? { cause: logged.cause } : {}),
    ...(logged.code ? { code: logged.code } : {}),
  }
  for (const key of Object.keys(error)) {
    if (key in plain || (logged.redacted && key === 'params')) continue
    plain[key] = (error as unknown as Record<string, unknown>)[key]
  }
  return plain
}

/** JSON replacer that serializes every `Error`, however deeply nested, as its plain form. */
const errorReplacer =
  (includeStack: boolean) =>
  (_key: string, value: unknown): unknown =>
    value instanceof Error ? toPlainError(value, includeStack) : value

/** Format objects for logging. */
const formatObject = (obj: unknown, isDev: boolean): string => {
  try {
    return JSON.stringify(obj, errorReplacer(isDev), isDev ? 2 : 0)
  } catch {
    return '[Circular or Non-Serializable Object]'
  }
}

/**
 * The error a line is about, chosen as `mergeArgs` chooses it: the last bare
 * `Error` argument, else the first `{ error }` field.
 */
const primaryError = (args: unknown[]): Error | undefined => {
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]
    if (arg instanceof Error) return arg
  }
  for (const arg of args) {
    if (isRecordLike(arg) && arg.error instanceof Error) return arg.error
  }
  return undefined
}

/** Adds an error's cause fields to the entry without displacing caller-supplied values. */
const assignErrorCause = (entry: Record<string, unknown>, logged: LoggedError) => {
  if (logged.cause !== undefined && entry.errorCause === undefined) entry.errorCause = logged.cause
  if (logged.code !== undefined && entry.errorCode === undefined) entry.errorCode = logged.code
}

/**
 * Merges caller-supplied log arguments into the structured entry.
 *
 * `Error.message` and `Error.stack` are non-enumerable, so `JSON.stringify`
 * renders an error held under a key as `{}` — and `logger.x('...', { error })`
 * is by far the most common call shape, which would otherwise reduce the one
 * field worth reading to an empty object. Errors nested in an object argument
 * are therefore unwrapped like a bare `Error` argument. `error` stays a plain
 * message string so log queries can group on it; the primary error's deepest
 * cause and its code go in `errorCause` and `errorCode`.
 */
const mergeArgs = (entry: Record<string, unknown>, args: unknown[]): Record<string, unknown> => {
  /** The error whose stack the line carries; its cause is assigned last so a later error cannot inherit an earlier one's. */
  let reported: LoggedError | undefined
  for (const arg of args) {
    if (arg === null || arg === undefined) continue
    if (arg instanceof Error) {
      reported = toLoggedError(arg)
      entry.error = reported.message
      entry.stack = reported.stack
    } else if (typeof arg === 'object') {
      const source = arg as Record<string, unknown>
      for (const key of Object.keys(source)) {
        const value = source[key]
        if (value instanceof Error) {
          const logged = toLoggedError(value)
          entry[key] = logged.message
          if (key === 'error' && entry.stack === undefined) {
            entry.stack = logged.stack
            reported = logged
          }
        } else {
          entry[key] = value
        }
      }
    } else {
      entry.extra = arg
    }
  }
  if (reported) assignErrorCause(entry, reported)
  return entry
}

/**
 * JSON replacer that tolerates cyclic references and BigInt values, and
 * serializes errors as their plain form like `errorReplacer`.
 */
const tolerantReplacer = () => {
  const ancestors: object[] = []
  /** What `JSON.stringify` descends into for each ancestor — an error's plain form, not the error. */
  const holders: object[] = []
  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString()
    if (value === null || typeof value !== 'object') return value
    /**
     * Track the ancestor path, not every object ever visited. `this` is the
     * object holding the current key, so unwinding to it drops the siblings we
     * have finished descending. A set of everything seen would label the second
     * appearance of a merely repeated reference `[Circular]` and discard real
     * data, since a payload that references one object twice has no cycle.
     */
    while (holders.length > 0 && holders[holders.length - 1] !== this) {
      holders.pop()
      ancestors.pop()
    }
    if (ancestors.includes(value)) return '[Circular]'
    const serialized = value instanceof Error ? toPlainError(value, false) : value
    ancestors.push(value)
    holders.push(serialized)
    return serialized
  }
}

/**
 * Builds and serializes a production log entry without ever throwing.
 *
 * Caller-supplied arguments are merged in verbatim, so a cyclic reference, a
 * BigInt, or a throwing getter would otherwise raise inside the caller's code
 * path — losing the line and aborting whatever was being logged about. A
 * logger must never be able to break its caller.
 */
const serializeEntry = (base: Record<string, unknown>, args: unknown[]): string => {
  try {
    return JSON.stringify(mergeArgs({ ...base }, args), errorReplacer(false))
  } catch {}

  try {
    return JSON.stringify(mergeArgs({ ...base }, args), tolerantReplacer())
  } catch {}

  return minimalEntry(base)
}

/**
 * Last-resort entry built only from fields this module controls.
 *
 * A replacer cannot rescue a throwing `toJSON`, because `JSON.stringify` invokes
 * it before the replacer ever sees the value. So the final fallback drops every
 * caller-supplied value instead of re-serializing it, and passes strings through
 * only when they are already strings — coercing would re-enter hostile
 * `toString`. What remains cannot throw.
 */
const minimalEntry = (base: Record<string, unknown>): string => {
  const asString = (value: unknown) => (typeof value === 'string' ? value : '[Unserializable]')
  return JSON.stringify({
    timestamp: asString(base.timestamp),
    level: asString(base.level),
    module: asString(base.module),
    message: asString(base.message),
    serializationError: true,
  })
}

/**
 * Copies caller-supplied metadata into a plain object without ever throwing.
 *
 * `LoggerMetadata` is structurally typed, so nothing stops a caller from handing
 * over an object carrying a throwing getter or a hostile proxy. A spread invokes
 * those traps, so the copy degrades key-by-key and finally to a marker rather
 * than raising inside the caller's code path.
 */
const materializeMetadata = (metadata: LoggerMetadata): LoggerMetadata => {
  try {
    return { ...metadata }
  } catch {}

  const safe: LoggerMetadata = {}
  try {
    for (const key of Object.keys(metadata)) {
      try {
        safe[key] = metadata[key]
      } catch {
        safe[key] = '[Unreadable]'
      }
    }
    return safe
  } catch {}

  return { metadataError: true }
}

/**
 * The request context's contribution to every log line in it. Only fields the
 * request actually established are set, so a line outside a request, or before
 * authentication, carries no empty keys to filter back out.
 */
const requestContextMetadata = (context: RequestContext): LoggerMetadata => {
  const metadata: LoggerMetadata = { requestId: context.requestId }
  if (context.method) metadata.method = context.method
  if (context.path) metadata.path = context.path
  if (context.traceId) metadata.traceId = context.traceId
  if (context.client) {
    metadata.surface = context.client.surface
    if (context.client.version) metadata.clientVersion = context.client.version
    if (context.client.name) metadata.clientName = context.client.name
    if (context.client.agent) metadata.codingAgent = context.client.agent
  }
  if (context.auth) {
    metadata.auth = context.auth.kind
    if (context.auth.service) metadata.authService = context.auth.service
    if (context.auth.clientId) metadata.authClientId = context.auth.clientId
  }
  if (context.callChain) metadata.callDepth = context.callChain.length
  return metadata
}

/**
 * Logger class for standardized console logging
 *
 * Provides methods for logging at different severity levels
 * and handles formatting, colorization, and environment-specific behavior.
 */
export class Logger {
  private module: string
  private config: ReturnType<typeof getLogConfig>
  private isDev: boolean
  private metadata: LoggerMetadata = {}

  /**
   * Create a new logger for a specific module
   * @param module The name of the module (e.g., 'OpenAIProvider', 'AgentBlockHandler')
   * @param overrideConfig Optional configuration overrides
   */
  constructor(module: string, overrideConfig?: LoggerConfig) {
    this.module = module
    this.config = getLogConfig()
    this.isDev = getNodeEnv() === 'development'

    // Apply overrides if provided
    if (overrideConfig) {
      if (overrideConfig.logLevel !== undefined) {
        const level =
          typeof overrideConfig.logLevel === 'string'
            ? (overrideConfig.logLevel as LogLevel)
            : overrideConfig.logLevel
        if (Object.values(LogLevel).includes(level)) {
          this.config.minLevel = level
        }
      }
      if (overrideConfig.colorize !== undefined) {
        this.config.colorize = overrideConfig.colorize
      }
      if (overrideConfig.enabled !== undefined) {
        this.config.enabled = overrideConfig.enabled
      }
    }
  }

  /**
   * Creates a child logger with additional metadata merged in.
   * The child inherits this logger's module name, config, and existing metadata.
   * New metadata keys override existing ones with the same name.
   */
  withMetadata(metadata: LoggerMetadata): Logger {
    const child = Object.create(Logger.prototype) as Logger
    child.module = this.module
    child.config = this.config
    child.isDev = this.isDev
    child.metadata = { ...this.metadata, ...materializeMetadata(metadata) }
    return child
  }

  /**
   * Determines if a log at the given level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false

    if (getNodeEnv() === 'production' && isBrowserRuntime()) {
      return false
    }

    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]
    const minLevelIndex = levels.indexOf(this.config.minLevel)
    const currentLevelIndex = levels.indexOf(level)

    return currentLevelIndex >= minLevelIndex
  }

  /**
   * Format arguments for logging, converting objects to JSON strings
   */
  private formatArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (arg === null || arg === undefined) return arg
      if (typeof arg === 'object') return formatObject(arg, this.isDev)
      return arg
    })
  }

  /**
   * Internal method to log a message with the specified level
   */
  private log(level: LogLevel, message: string, ...args: unknown[]) {
    if (!this.shouldLog(level)) return

    const timestamp = new Date().toISOString()
    const formattedArgs = this.formatArgs(args)

    const reqCtx = getRequestContext()
    const effectiveMetadata = reqCtx
      ? { ...requestContextMetadata(reqCtx), ...this.metadata }
      : this.metadata
    emitOtelLogRecord(level, this.module, message, effectiveMetadata, args)
    const metadataEntries = Object.entries(filterUndefined(effectiveMetadata))
    const metadataStr =
      metadataEntries.length > 0
        ? ` {${metadataEntries.map(([k, v]) => `${k}=${v}`).join(' ')}}`
        : ''

    if (this.config.colorize) {
      let levelColor: (text: string) => string
      const moduleColor = chalk.cyan
      const timestampColor = chalk.gray

      switch (level) {
        case LogLevel.DEBUG:
          levelColor = chalk.blue
          break
        case LogLevel.INFO:
          levelColor = chalk.green
          break
        case LogLevel.WARN:
          levelColor = chalk.yellow
          break
        case LogLevel.ERROR:
          levelColor = chalk.red
          break
      }

      const coloredMeta = metadataStr ? ` ${chalk.magenta(metadataStr.trim())}` : ''
      const coloredPrefix = `${timestampColor(`[${timestamp}]`)} ${levelColor(`[${level}]`)} ${moduleColor(`[${this.module}]`)}${coloredMeta}`

      if (level === LogLevel.ERROR) {
        console.error(coloredPrefix, message, ...formattedArgs)
      } else {
        console.log(coloredPrefix, message, ...formattedArgs)
      }
    } else {
      // Structured JSON for production — CloudWatch Log Insights auto-parses JSON lines
      const base: Record<string, unknown> = {
        timestamp,
        level,
        module: this.module,
        message,
      }
      for (const [k, v] of metadataEntries) {
        base[k] = v
      }

      const line = serializeEntry(base, args)
      if (level === LogLevel.ERROR) {
        console.error(line)
      } else {
        console.log(line)
      }
    }
  }

  /**
   * Log a debug message
   *
   * Use for detailed information useful during development and debugging.
   * These logs are only shown in development environment by default.
   */
  debug(message: string, ...args: unknown[]) {
    this.log(LogLevel.DEBUG, message, ...args)
  }

  /**
   * Log an info message
   *
   * Use for general information about application operation.
   */
  info(message: string, ...args: unknown[]) {
    this.log(LogLevel.INFO, message, ...args)
  }

  /**
   * Log a warning message
   *
   * Use for potentially problematic situations that don't cause operation failure.
   */
  warn(message: string, ...args: unknown[]) {
    this.log(LogLevel.WARN, message, ...args)
  }

  /**
   * Log an error message
   *
   * Use for error events that might still allow the application to continue.
   */
  error(message: string, ...args: unknown[]) {
    this.log(LogLevel.ERROR, message, ...args)
  }
}

/**
 * Create a logger for a specific module
 *
 * @example
 * ```typescript
 * import { createLogger } from '@sim/logger'
 *
 * const logger = createLogger('MyComponent')
 *
 * logger.debug('Initializing component', { props })
 * logger.info('Component mounted')
 * logger.warn('Deprecated prop used', { propName })
 * logger.error('Failed to fetch data', error)
 * ```
 *
 * @param module The name of the module
 * @param config Optional configuration overrides
 * @returns A Logger instance
 */
export function createLogger(module: string, config?: LoggerConfig): Logger {
  return new Logger(module, config)
}

export type { RequestAuth, RequestContext, SetRequestAuthOptions } from './request-context'
export {
  getRequestContext,
  runWithRequestContext,
  setRequestAuth,
  setRequestTraceId,
} from './request-context'

const OTEL_LOG_SEVERITY: Record<LogLevel, { number: SeverityNumber; text: string }> = {
  [LogLevel.DEBUG]: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  [LogLevel.INFO]: { number: SeverityNumber.INFO, text: 'INFO' },
  [LogLevel.WARN]: { number: SeverityNumber.WARN, text: 'WARN' },
  [LogLevel.ERROR]: { number: SeverityNumber.ERROR, text: 'ERROR' },
}

const OTEL_LOG_ARG_MAX_CHARS = 2000

/**
 * Fans every accepted log line out through the OTel Logs API. Until an
 * application installs a global LoggerProvider (apps/sim does in
 * instrumentation-node.ts), the api-logs global is a no-op delegate, so this
 * costs nothing in browsers, tests, and services that do not export logs.
 * The active trace context is attached by the SDK, which is what enables
 * span → logs correlation in the backend. Never allowed to throw into the
 * console write path.
 */
function emitOtelLogRecord(
  level: LogLevel,
  module: string,
  message: string,
  metadata: Record<string, unknown>,
  args: unknown[]
): void {
  try {
    const severity = OTEL_LOG_SEVERITY[level]
    const attributes: Record<string, string> = { 'log.module': module }
    for (const [key, value] of Object.entries(filterUndefined(metadata))) {
      attributes[key] = String(value)
    }
    const error = primaryError(args)
    if (error) {
      const logged = toLoggedError(error)
      attributes['error.message'] = logged.message
      if (logged.stack) attributes['error.stack'] = logged.stack
      if (logged.cause) attributes['error.cause'] = logged.cause
    }
    const plainArgs = args.filter((arg) => !(arg instanceof Error))
    if (plainArgs.length > 0) {
      try {
        attributes['log.args'] = JSON.stringify(plainArgs, errorReplacer(false)).slice(
          0,
          OTEL_LOG_ARG_MAX_CHARS
        )
      } catch {
        attributes['log.args'] = String(plainArgs).slice(0, OTEL_LOG_ARG_MAX_CHARS)
      }
    }
    logs.getLogger('sim').emit({
      severityNumber: severity.number,
      severityText: severity.text,
      body: message,
      attributes,
    })
  } catch {
    // Log export must never break the primary console write path.
  }
}
