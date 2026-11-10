import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
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

  it.each(['ab #cd', 'a#b', '  padded ', "'starts-with-quote", "it's #1", "it's $5 #1"])(
    'reads back %j exactly as it was written',
    (value) => {
      expect(parseEnv(upsertEnv('', 'SECRET', value)).get('SECRET')).toBe(value)
    }
  )

  it.each(['pa$$word', 'key$HOME', `key\${HOME}suffix`, "it's $5"])(
    'Next loads %j back exactly as it was written',
    (value) => {
      const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-env-expand-'))
      roots.push(root)
      writeFileSync(path.join(root, '.env'), upsertEnv('', 'SIM_SETUP_EXPAND_PROBE', value))
      const silent = { info: () => {}, error: () => {} }
      try {
        const { parsedEnv } = loadEnvConfig(root, false, silent, true)
        expect(parsedEnv?.SIM_SETUP_EXPAND_PROBE).toBe(value)
      } finally {
        Reflect.deleteProperty(process.env, 'SIM_SETUP_EXPAND_PROBE')
      }
    }
  )

  it('writes an ordinary value without quotes', () => {
    const dsn = 'postgresql://postgres:p%23w@127.0.0.1:5432/simstudio'
    expect(upsertEnv('', 'DATABASE_URL', dsn)).toBe(`DATABASE_URL=${dsn}\n`)
  })

  it('refuses a value that would spill onto a second line', () => {
    expect(() => upsertEnv('', 'SECRET', 'first\nINJECTED=1')).toThrow('line break')
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
