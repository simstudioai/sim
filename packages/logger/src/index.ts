/**
 * @sim/logger
 *
 * Framework-agnostic logging utilities for the Sim platform.
 * Provides standardized console logging with environment-aware configuration.
 */
import { filterUndefined } from '@sim/utils/object'
import chalk from 'chalk'
import { getRequestContext } from './request-context'

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

/**
 * Format objects for logging
 */
const formatObject = (obj: unknown, isDev: boolean): string => {
  try {
    if (obj instanceof Error) {
      const errorObj: Record<string, unknown> = {
        message: obj.message,
        stack: isDev ? obj.stack : undefined,
        name: obj.name,
      }
      for (const key of Object.keys(obj)) {
        if (!(key in errorObj)) {
          errorObj[key] = (obj as unknown as Record<string, unknown>)[key]
        }
      }
      return JSON.stringify(errorObj, null, isDev ? 2 : 0)
    }
    return JSON.stringify(obj, null, isDev ? 2 : 0)
  } catch {
    return '[Circular or Non-Serializable Object]'
  }
}

/** Merges caller-supplied log arguments into the structured entry. */
const mergeArgs = (entry: Record<string, unknown>, args: unknown[]): Record<string, unknown> => {
  for (const arg of args) {
    if (arg === null || arg === undefined) continue
    if (arg instanceof Error) {
      entry.error = arg.message
      entry.stack = arg.stack
    } else if (typeof arg === 'object') {
      Object.assign(entry, arg)
    } else {
      entry.extra = arg
    }
  }
  return entry
}

/** JSON replacer that tolerates cyclic references and BigInt values. */
const tolerantReplacer = () => {
  const ancestors: object[] = []
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
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop()
    if (ancestors.includes(value)) return '[Circular]'
    ancestors.push(value)
    return value
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
    return JSON.stringify(mergeArgs({ ...base }, args))
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
      ? {
          requestId: reqCtx.requestId,
          method: reqCtx.method,
          path: reqCtx.path,
          ...this.metadata,
        }
      : this.metadata
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

export type { RequestContext } from './request-context'
export { getRequestContext, runWithRequestContext } from './request-context'
