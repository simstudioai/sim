import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { choosePostgresPassword, LEGACY_POSTGRES_PASSWORD } from './compose-database'

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

describe('choosePostgresPassword', () => {
  const noShell = {}

  it('keeps the legacy password for a volume created before it was required', () => {
    expect(
      choosePostgresPassword('', 'sim-abc', { shell: noShell, hasDatabaseVolume: () => true })
    ).toEqual({ value: LEGACY_POSTGRES_PASSWORD, source: 'legacy' })
  })

  it('refuses an empty shell export, which Compose would use over .env', () => {
    for (const envFileValue of [undefined, 'in-env-file']) {
      expect(() =>
        choosePostgresPassword(envFileValue, 'sim-abc', { shell: { POSTGRES_PASSWORD: '' } })
      ).toThrow(/exported but empty/)
    }
  })
})

describe('shipped Compose files', () => {
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
