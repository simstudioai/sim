import { describe, expect, it } from 'bun:test'
import {
  isPlaceholder,
  isUsableSecret,
  parseEnv,
  reconcileEnvContent,
  upsertEnv,
} from './env-files.ts'

describe('placeholder detection', () => {
  it('recognizes underscore and hyphen template prefixes', () => {
    expect(isPlaceholder('your_secret_key')).toBe(true)
    expect(isPlaceholder('your-secure-production-auth-secret-here')).toBe(true)
    expect(isUsableSecret('BETTER_AUTH_SECRET', 'your-secure-production-auth-secret-here')).toBe(
      false
    )
    expect(isPlaceholder('yourActualSecret')).toBe(false)
  })
})

describe('upsertEnv', () => {
  it('writes the value that parseEnv will use', () => {
    const updated = upsertEnv('RESEND_API_KEY=old\nOTHER=value\n', 'RESEND_API_KEY', 'current')

    expect(parseEnv(updated).get('RESEND_API_KEY')).toBe('current')
  })

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
  it('applies provider removals and replacements to one snapshot', () => {
    const reconciled = reconcileEnvContent(
      'SMTP_HOST=old-host\nSMTP_PORT=587\nRESEND_API_KEY=old-key\n',
      ['SMTP_HOST', 'SMTP_PORT'],
      { RESEND_API_KEY: 'new-key' }
    )

    expect(parseEnv(reconciled)).toEqual(new Map([['RESEND_API_KEY', 'new-key']]))
  })

  it('fails before returning content when a replacement key is duplicated', () => {
    const content = 'SMTP_HOST=old-host\nRESEND_API_KEY=old-key\nRESEND_API_KEY=newer-key\n'

    expect(() =>
      reconcileEnvContent(content, ['SMTP_HOST'], { RESEND_API_KEY: 'replacement' })
    ).toThrow('Duplicate active RESEND_API_KEY entries')
    expect(parseEnv(content).get('SMTP_HOST')).toBe('old-host')
  })
})
