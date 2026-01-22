/**
 * @sim/logger
 *
 * Framework-agnostic logging utilities for the Sim platform.
 * Provides standardized console logging with environment-aware configuration.
 */
import chalk from 'chalk'

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

const getNodeEnv = (): string => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV || 'development'
  }
  return 'development'
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
   * Determines if a log at the given level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false

    if (getNodeEnv() === 'production' && typeof window !== 'undefined') {
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

      const coloredPrefix = `${timestampColor(`[${timestamp}]`)} ${levelColor(`[${level}]`)} ${moduleColor(`[${this.module}]`)}`

      if (level === LogLevel.ERROR) {
        console.error(coloredPrefix, message, ...formattedArgs)
      } else {
        console.log(coloredPrefix, message, ...formattedArgs)
      }
    } else {
      const prefix = `[${timestamp}] [${level}] [${this.module}]`

      if (level === LogLevel.ERROR) {
        console.error(prefix, message, ...formattedArgs)
      } else {
        console.log(prefix, message, ...formattedArgs)
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
