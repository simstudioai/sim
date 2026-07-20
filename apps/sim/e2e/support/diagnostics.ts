import { existsSync, readFileSync } from 'node:fs'

const FORBIDDEN_PROVIDER_LOG_PATTERNS = [
  /api\.stripe\.com/i,
  /api\.agentmail\.to/i,
  /telemetry\.simstudio\.ai/i,
  /Failed to fetch Ollama models/i,
  /Failed to initialize .*provider/i,
  /Failed to initialize .*client/i,
]

/**
 * Scan only service startup logs. Later settings tests intentionally exercise
 * URL-validation denials whose error copy must not be treated as provider boot.
 */
export function assertNoForbiddenProviderInitialization(logPaths: string[]): void {
  const violations: string[] = []
  for (const logPath of logPaths) {
    if (!existsSync(logPath)) continue
    const contents = readFileSync(logPath, 'utf8')
    for (const pattern of FORBIDDEN_PROVIDER_LOG_PATTERNS) {
      if (pattern.test(contents)) violations.push(`${logPath}: ${pattern}`)
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Shadowed or forbidden provider initialization was detected:\n${violations.join('\n')}`
    )
  }
}
