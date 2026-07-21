import { existsSync, readFileSync } from 'node:fs'

const FORBIDDEN_PROVIDER_TRAFFIC_PATTERNS = [
  /api\.stripe\.com/i,
  /api\.agentmail\.to/i,
  /telemetry\.simstudio\.ai/i,
  /Failed to fetch Ollama models/i,
]

const FORBIDDEN_PROVIDER_STARTUP_PATTERNS = [
  ...FORBIDDEN_PROVIDER_TRAFFIC_PATTERNS,
  /Failed to initialize .*provider/i,
  /Failed to initialize .*client/i,
]

/**
 * Scan only service startup logs. Later settings tests intentionally exercise
 * URL-validation denials whose error copy must not be treated as provider boot.
 */
export function assertNoForbiddenProviderInitialization(logPaths: string[]): void {
  assertLogsDoNotMatch(
    logPaths,
    FORBIDDEN_PROVIDER_STARTUP_PATTERNS,
    'Shadowed or forbidden provider initialization was detected'
  )
}

/**
 * Re-scan after browser activity using only concrete outbound signatures.
 * Intentional URL-validation errors in later workflow suites remain allowed.
 */
export function assertNoForbiddenProviderTraffic(logPaths: string[]): void {
  assertLogsDoNotMatch(
    logPaths,
    FORBIDDEN_PROVIDER_TRAFFIC_PATTERNS,
    'Forbidden provider traffic was detected'
  )
}

function assertLogsDoNotMatch(logPaths: string[], patterns: RegExp[], message: string): void {
  const violations: string[] = []
  for (const logPath of logPaths) {
    if (!existsSync(logPath)) continue
    const contents = readFileSync(logPath, 'utf8')
    for (const pattern of patterns) {
      if (pattern.test(contents)) violations.push(`${logPath}: ${pattern}`)
    }
  }
  if (violations.length > 0) {
    throw new Error(`${message}:\n${violations.join('\n')}`)
  }
}
