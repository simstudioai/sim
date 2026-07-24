import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { SIM_APP_DIR } from './paths'

const ENV_KEY_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/
const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:API_?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_?KEY|CLIENT_?SECRET|WEBHOOK)(?:_|$)/i

const OS_PASSTHROUGH_KEYS = [
  'PATH',
  'USER',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SYSTEMROOT',
  'CI',
  'GITHUB_ACTIONS',
] as const

export interface ChildEnvironment {
  env: Record<string, string>
  discoveredKeys: string[]
  shadowedKeys: string[]
}

export interface BuildChildEnvironmentOptions {
  values: Record<string, string>
  required: readonly string[]
  allowedSensitiveKeys: ReadonlySet<string>
  envDirectory?: string
  shadowDiscovered?: boolean
}

export function discoverEnvFileKeys(directory = SIM_APP_DIR): string[] {
  if (!existsSync(directory)) return []

  const keys = new Set<string>()
  const files = readdirSync(directory)
    .filter((name) => name === '.env' || name.startsWith('.env.'))
    .sort()

  for (const file of files) {
    const contents = readFileSync(path.join(directory, file), 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const match = ENV_KEY_PATTERN.exec(line)
      if (match) keys.add(match[1])
    }
  }

  return [...keys].sort()
}

export function buildChildEnvironment({
  values,
  required,
  allowedSensitiveKeys,
  envDirectory = SIM_APP_DIR,
  shadowDiscovered = true,
}: BuildChildEnvironmentOptions): ChildEnvironment {
  const missing = required.filter((key) => !values[key]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required E2E environment values: ${missing.join(', ')}`)
  }

  const env: Record<string, string> = {}
  for (const key of OS_PASSTHROUGH_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }

  for (const [key, value] of Object.entries(values)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && !allowedSensitiveKeys.has(key)) {
      throw new Error(`Sensitive E2E environment key is not explicitly allowed: ${key}`)
    }
    env[key] = value
  }

  const discoveredKeys = discoverEnvFileKeys(envDirectory)
  const shadowedKeys: string[] = []
  if (shadowDiscovered) {
    for (const key of discoveredKeys) {
      if (key in env) continue
      env[key] = ''
      shadowedKeys.push(key)
    }
  }

  return { env, discoveredKeys, shadowedKeys }
}

export function formatRedactedEnvironmentSummary(
  profile: string,
  childEnvironment: ChildEnvironment
): string {
  return [
    `E2E profile: ${profile}`,
    `Allowed keys: ${Object.keys(childEnvironment.env)
      .filter((key) => !childEnvironment.shadowedKeys.includes(key))
      .sort()
      .join(', ')}`,
    `Shadowed local keys: ${childEnvironment.shadowedKeys.join(', ') || '(none)'}`,
  ].join('\n')
}
