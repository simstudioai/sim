import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  choosePostgresPassword,
  composeFileRequiresPostgresPassword,
  configuredPostgresPassword,
  LEGACY_POSTGRES_PASSWORD,
} from './compose-database'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const COMPOSE_FILES = [
  'docker-compose.prod.yml',
  'docker-compose.local.yml',
  'docker-compose.ollama.yml',
] as const

function composePath(file: string): string {
  return path.join(REPO_ROOT, file)
}

/** The lines of one top-level service, up to the next service or top-level key. */
function serviceBlock(file: string, service: string): string {
  const lines = readFileSync(composePath(file), 'utf8').split('\n')
  const start = lines.findIndex((line) => line === `  ${service}:`)
  if (start === -1) throw new Error(`${file} has no ${service} service`)
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}[A-Za-z0-9_-]+:/.test(line))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('choosePostgresPassword', () => {
  it('leaves a configured password alone without looking for a volume', () => {
    const lookup = vi.fn(() => true)
    expect(choosePostgresPassword('already-set', 'sim-abc', lookup)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('generates a password for a project with no database volume yet', () => {
    const lookup = vi.fn(() => false)
    const choice = choosePostgresPassword(undefined, 'sim-abc', lookup)
    expect(lookup).toHaveBeenCalledWith('sim-abc')
    expect(choice?.legacy).toBe(false)
    expect(choice?.value).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the legacy password for a volume created before it was required', () => {
    const choice = choosePostgresPassword(undefined, 'sim-abc', () => true)
    expect(choice).toEqual({ value: LEGACY_POSTGRES_PASSWORD, legacy: true })
  })
})

describe('configuredPostgresPassword', () => {
  it('prefers the shell environment, which Compose interpolates over .env', () => {
    vi.stubEnv('POSTGRES_PASSWORD', 'from-shell')
    expect(configuredPostgresPassword('from-env-file')).toBe('from-shell')
  })

  it('falls back to .env and treats empty values as unset', () => {
    vi.stubEnv('POSTGRES_PASSWORD', '')
    expect(configuredPostgresPassword('from-env-file')).toBe('from-env-file')
    expect(configuredPostgresPassword('')).toBeUndefined()
    expect(configuredPostgresPassword(undefined)).toBeUndefined()
  })
})

describe('shipped Compose files', () => {
  it('only the production file requires POSTGRES_PASSWORD', () => {
    expect(composeFileRequiresPostgresPassword(composePath('docker-compose.prod.yml'))).toBe(true)
    expect(composeFileRequiresPostgresPassword(composePath('docker-compose.local.yml'))).toBe(false)
    expect(composeFileRequiresPostgresPassword(composePath('docker-compose.ollama.yml'))).toBe(
      false
    )
  })

  it('never falls back to a default password in the production file', () => {
    const contents = readFileSync(composePath('docker-compose.prod.yml'), 'utf8')
    const references = contents.match(/\$\{POSTGRES_PASSWORD[^}]*\}/g) ?? []
    expect(references).toHaveLength(4)
    for (const reference of references) {
      expect(reference.startsWith('${POSTGRES_PASSWORD:?')).toBe(true)
    }
  })

  it.each(COMPOSE_FILES)('%s does not publish the database to the host', (file) => {
    expect(serviceBlock(file, 'db')).not.toMatch(/^\s+ports:/m)
  })
})
