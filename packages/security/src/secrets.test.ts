import { describe, expect, it } from 'vitest'
import { assertUsableSecrets, hasUnexpandedShellSubstitution, SECRET_ENV_KEYS } from './secrets'

describe('hasUnexpandedShellSubstitution', () => {
  it('detects the command substitution Compose passes through verbatim', () => {
    expect(hasUnexpandedShellSubstitution('sim_auth_secret_$(openssl rand -hex 16)')).toBe(true)
    expect(hasUnexpandedShellSubstitution('$(openssl rand -hex 32)')).toBe(true)
  })

  it('detects backtick substitution', () => {
    expect(hasUnexpandedShellSubstitution('`openssl rand -hex 32`')).toBe(true)
  })

  it('accepts real secrets, including passphrases holding $ or braces', () => {
    expect(hasUnexpandedShellSubstitution('a'.repeat(64))).toBe(false)
    expect(hasUnexpandedShellSubstitution('7f3c$aa9/b+2==')).toBe(false)
    expect(hasUnexpandedShellSubstitution('pa$$word{1}')).toBe(false)
    expect(hasUnexpandedShellSubstitution('literal-${BRACES}-passphrase')).toBe(false)
  })
})

describe('assertUsableSecrets', () => {
  it('throws naming the variable and quoting the literal in use', () => {
    expect(() => assertUsableSecrets({ ENCRYPTION_KEY: '$(openssl rand -hex 32)' })).toThrow(
      /ENCRYPTION_KEY=\$\(openssl rand -hex 32\)/
    )
  })

  it('reports every offender at once', () => {
    expect(() =>
      assertUsableSecrets({
        BETTER_AUTH_SECRET: '$(openssl rand -hex 16)',
        ENCRYPTION_KEY: '`openssl rand -hex 32`',
      })
    ).toThrow(/2 secret\(s\)/)
  })

  it('ignores absent and empty values so an unconfigured build is unaffected', () => {
    expect(() =>
      assertUsableSecrets({
        BETTER_AUTH_SECRET: 'a'.repeat(64),
        CRON_SECRET: undefined,
        API_ENCRYPTION_KEY: '',
      })
    ).not.toThrow()
  })
})

describe('SECRET_ENV_KEYS', () => {
  it('covers the secrets the app signs and encrypts with', () => {
    expect(SECRET_ENV_KEYS).toContain('BETTER_AUTH_SECRET')
    expect(SECRET_ENV_KEYS).toContain('ENCRYPTION_KEY')
    expect(SECRET_ENV_KEYS).toContain('INTERNAL_API_SECRET')
  })
})
