import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEnv, reconcileEnvContent, upsertEnv, writeEnvFile } from './env-files'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('upsertEnv', () => {
  it('fails fast when duplicate active entries make the effective write ambiguous', () => {
    expect(() =>
      upsertEnv(
        'RESEND_API_KEY=old\nexport RESEND_API_KEY=current\n',
        'RESEND_API_KEY',
        'replacement'
      )
    ).toThrow('Duplicate active RESEND_API_KEY entries')
  })
})

describe('reconcileEnvContent', () => {
  it('fails before returning content when a replacement key is duplicated', () => {
    const content = 'SMTP_HOST=old-host\nRESEND_API_KEY=old-key\nRESEND_API_KEY=newer-key\n'

    expect(() =>
      reconcileEnvContent(content, ['SMTP_HOST'], { RESEND_API_KEY: 'replacement' })
    ).toThrow('Duplicate active RESEND_API_KEY entries')
    expect(parseEnv(content).get('SMTP_HOST')).toBe('old-host')
  })
})

describe('writeEnvFile', () => {
  it('replaces existing contents with owner-only permissions', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-env-file-'))
    roots.push(root)
    const file = path.join(root, '.env')
    writeFileSync(file, 'OLD=value\n')
    chmodSync(file, 0o644)

    writeEnvFile(file, 'SECRET=current\n')

    expect(readFileSync(file, 'utf8')).toBe('SECRET=current\n')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
