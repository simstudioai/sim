import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  choosePostgresPassword,
  composeFileRequiresPostgresPassword,
  LEGACY_POSTGRES_PASSWORD,
  postgresUser,
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
  const noShell = {}

  it('leaves a password already in .env alone without looking for a volume', () => {
    const hasDatabaseVolume = vi.fn(() => true)
    expect(
      choosePostgresPassword('in-env-file', 'sim-abc', { shell: noShell, hasDatabaseVolume })
    ).toBeNull()
    expect(hasDatabaseVolume).not.toHaveBeenCalled()
  })

  it('generates a password for a project with no database volume yet', () => {
    const hasDatabaseVolume = vi.fn(() => false)
    const choice = choosePostgresPassword(undefined, 'sim-abc', {
      shell: noShell,
      hasDatabaseVolume,
    })
    expect(hasDatabaseVolume).toHaveBeenCalledWith('sim-abc')
    expect(choice?.source).toBe('generated')
    expect(choice?.value).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the legacy password for a volume created before it was required', () => {
    expect(
      choosePostgresPassword('', 'sim-abc', { shell: noShell, hasDatabaseVolume: () => true })
    ).toEqual({ value: LEGACY_POSTGRES_PASSWORD, source: 'legacy' })
  })

  it('leaves a shell-exported password to the operator, since Compose uses it', () => {
    const hasDatabaseVolume = vi.fn(() => true)
    expect(
      choosePostgresPassword(undefined, 'sim-abc', {
        shell: { POSTGRES_PASSWORD: 'in-shell' },
        hasDatabaseVolume,
      })
    ).toBeNull()
    expect(hasDatabaseVolume).not.toHaveBeenCalled()
  })

  it('refuses an empty shell export, which Compose would use over .env', () => {
    for (const envFileValue of [undefined, 'in-env-file']) {
      expect(() =>
        choosePostgresPassword(envFileValue, 'sim-abc', { shell: { POSTGRES_PASSWORD: '' } })
      ).toThrow(/exported but empty/)
    }
  })

  it('reads the process environment by default', () => {
    vi.stubEnv('POSTGRES_PASSWORD', 'from-process')
    expect(
      choosePostgresPassword(undefined, 'sim-abc', { hasDatabaseVolume: () => true })
    ).toBeNull()
  })
})

describe('postgresUser', () => {
  it('follows Compose: a shell export wins even when empty, then .env, then the default', () => {
    vi.stubEnv('POSTGRES_USER', 'from-shell')
    expect(postgresUser('from-env-file')).toBe('from-shell')
    vi.stubEnv('POSTGRES_USER', '')
    expect(postgresUser('from-env-file')).toBe('postgres')
    vi.stubEnv('POSTGRES_USER', undefined)
    expect(postgresUser('from-env-file')).toBe('from-env-file')
    expect(postgresUser(undefined)).toBe('postgres')
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
