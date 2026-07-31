import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateRandomHex } from '@sim/utils/random'

export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

export type EnvTarget = 'sim' | 'realtime' | 'db' | 'root'

export const ENV_PATHS: Record<EnvTarget, string> = {
  sim: path.join(ROOT, 'apps/sim/.env'),
  realtime: path.join(ROOT, 'apps/realtime/.env'),
  db: path.join(ROOT, 'packages/db/.env'),
  root: path.join(ROOT, '.env'),
}

const EXAMPLE_PATHS: Partial<Record<EnvTarget, string>> = {
  sim: path.join(ROOT, 'apps/sim/.env.example'),
  realtime: path.join(ROOT, 'apps/realtime/.env.example'),
  db: path.join(ROOT, 'packages/db/.env.example'),
}

/** Keys that must be byte-identical between apps/sim/.env and apps/realtime/.env. */
export const SHARED_KEYS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'INTERNAL_API_SECRET',
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_APP_URL',
] as const

export const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
  'API_ENCRYPTION_KEY',
] as const

const PLACEHOLDER_VALUES = new Set([
  'your_password',
  'your_secret_key',
  'your_encryption_key',
  'your_internal_api_secret',
  'your_api_encryption_key',
  'your_better_auth_secret_min_32_chars',
  'dev-secret-at-least-32-characters-long',
  'dev-encryption-key-at-least-32-chars',
  'dev-internal-api-secret-min-32-chars',
])

export interface EnvFile {
  target: EnvTarget
  path: string
  exists: boolean
  content: string
  vars: Map<string, string>
}

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

function parseValue(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]
    const end = trimmed.indexOf(quote, 1)
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)
  }
  return trimmed.replace(/\s+#.*$/, '').trim()
}

export function parseEnv(content: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of content.split('\n')) {
    const match = LINE_RE.exec(line)
    if (match && !vars.has(match[1])) vars.set(match[1], parseValue(match[2]))
  }
  return vars
}

export function readEnvFile(target: EnvTarget): EnvFile {
  const filePath = ENV_PATHS[target]
  const exists = existsSync(filePath)
  const content = exists ? readFileSync(filePath, 'utf8') : ''
  return { target, path: filePath, exists, content, vars: parseEnv(content) }
}

/**
 * Sets a key in env-file content: replaces the active line, uncomments a
 * commented-out line, or appends. Returns the new content.
 */
export function upsertEnv(content: string, key: string, value: string): string {
  const lines = content.split('\n')
  const activeRe = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`)
  const commentedRe = new RegExp(`^#\\s*${key}\\s*=`)
  const activeIdx = lines.findIndex((l) => activeRe.test(l))
  const idx = activeIdx !== -1 ? activeIdx : lines.findIndex((l) => commentedRe.test(l))
  const newLine = `${key}=${value}`
  if (idx === -1) {
    const trailing = lines.length > 0 && lines[lines.length - 1] === ''
    if (trailing) lines.splice(lines.length - 1, 0, newLine)
    else lines.push(newLine)
  } else {
    lines[idx] = newLine
  }
  return lines.join('\n')
}

/** Writes values into an env file, seeding a missing file from its .env.example. */
export function writeEnvValues(target: EnvTarget, values: Record<string, string>): void {
  const filePath = ENV_PATHS[target]
  let content: string
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8')
  } else {
    const example = EXAMPLE_PATHS[target]
    content = example && existsSync(example) ? readFileSync(example, 'utf8') : ''
  }
  for (const [key, value] of Object.entries(values)) {
    content = upsertEnv(content, key, value)
  }
  writeFileSync(filePath, content)
}

export function archiveEnvFile(target: EnvTarget): string | null {
  const filePath = ENV_PATHS[target]
  if (!existsSync(filePath)) return null
  const backup = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(filePath, backup)
  return backup
}

export function generateSecret(): string {
  return generateRandomHex(64)
}

/**
 * `ENCRYPTION_KEY` and `API_ENCRYPTION_KEY` are read as raw AES-256 material,
 * so the app requires exactly 64 hex characters and throws on anything else
 * (`lib/core/security/encryption.ts`, `lib/api-key/crypto.ts`). A merely-long
 * passphrase passes a length check and then fails every encryption path at
 * runtime, so those two are validated on format rather than length.
 *
 * Lives here so setup (which replaces an unusable secret) and doctor (which
 * reports one) apply the same rule — they disagreed while it was duplicated.
 */
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i
const HEX_SECRET_KEYS = new Set<string>(['ENCRYPTION_KEY', 'API_ENCRYPTION_KEY'])

export function isUsableSecret(key: string, value: string): boolean {
  if (isPlaceholder(value)) return false
  return HEX_SECRET_KEYS.has(key) ? HEX_KEY_PATTERN.test(value) : value.length >= 32
}

/** Human-readable reason a secret is unusable, for doctor's finding message. */
export function secretRequirement(key: string): string {
  return HEX_SECRET_KEYS.has(key)
    ? 'must be exactly 64 hex characters (32-byte AES key)'
    : 'must be at least 32 characters'
}

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value) || value.startsWith('your_')
}

/**
 * Mirrors the app's `isTruthy` (apps/sim/lib/core/config/env.ts:633) exactly —
 * `true` or `1` only. The app's separate `envBoolean` additionally accepts
 * `yes`/`on`, but feature flags read through `isTruthy`, so accepting the wider
 * set here made the wizard and doctor report a flag as on that the app treats
 * as off.
 */
export function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false
  return value.toLowerCase() === 'true' || value === '1'
}
