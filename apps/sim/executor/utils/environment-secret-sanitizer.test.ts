import { describe, expect, it } from 'vitest'
import { createEnvironmentSecretSanitizer } from '@/executor/utils/environment-secret-sanitizer'

describe('createEnvironmentSecretSanitizer', () => {
  it('sanitizes referenced values recursively without mutating the source', () => {
    const secret = 'top-secret/value'
    const source = {
      message: `Bearer ${secret}`,
      nested: [{ [secret]: secret }],
    }
    const sanitize = createEnvironmentSecretSanitizer(
      { credential: '{{API_SECRET}}' },
      { API_SECRET: secret }
    )

    const sanitized = sanitize(source)

    expect(sanitized).toEqual({
      message: 'Bearer {{API_SECRET}}',
      nested: [{ '{{API_SECRET}}': '{{API_SECRET}}' }],
    })
    expect(source).toEqual({
      message: `Bearer ${secret}`,
      nested: [{ [secret]: secret }],
    })
    expect(sanitized).not.toBe(source)
    expect(sanitized.nested).not.toBe(source.nested)
  })

  it('sanitizes URL-encoded secret values', () => {
    const secret = 'secret/value with spaces'
    const sanitize = createEnvironmentSecretSanitizer('{{API_SECRET}}', { API_SECRET: secret })

    expect(sanitize(`token=${encodeURIComponent(secret)}`)).toBe('token={{API_SECRET}}')
  })

  it('sanitizes mixed-case percent escapes without folding ordinary characters', () => {
    const secret = 'CaseSensitive/value:next'
    const sanitize = createEnvironmentSecretSanitizer('{{API_SECRET}}', { API_SECRET: secret })

    expect(sanitize('token=CaseSensitive%2fvalue%3Anext')).toBe('token={{API_SECRET}}')
    expect(sanitize('token=casesensitive%2fvalue%3Anext')).toBe(
      'token=casesensitive%2fvalue%3Anext'
    )
  })

  it('sanitizes form-encoded secrets that use plus for spaces', () => {
    const secret = 'secret value/next'
    const sanitize = createEnvironmentSecretSanitizer('{{API_SECRET}}', { API_SECRET: secret })

    expect(sanitize('token=secret+value%2fnext')).toBe('token={{API_SECRET}}')
  })

  it('still sanitizes literal values that cannot be URI encoded', () => {
    const secret = `secret-${String.fromCharCode(0xd800)}`
    const sanitize = createEnvironmentSecretSanitizer('{{API_SECRET}}', { API_SECRET: secret })

    expect(sanitize(secret)).toBe('{{API_SECRET}}')
  })

  it('only uses environment variables referenced by the block configuration', () => {
    const sanitize = createEnvironmentSecretSanitizer(
      { credential: '{{REFERENCED}}' },
      {
        REFERENCED: 'replace-me',
        UNREFERENCED: 'ordinary-value',
      }
    )

    expect(sanitize('replace-me ordinary-value')).toBe('{{REFERENCED}} ordinary-value')
  })

  it('ignores empty and missing referenced values', () => {
    const sanitize = createEnvironmentSecretSanitizer(['{{EMPTY}}', '{{MISSING}}'], { EMPTY: '' })

    expect(sanitize('unchanged')).toBe('unchanged')
  })

  it('replaces overlapping values longest first', () => {
    const sanitize = createEnvironmentSecretSanitizer(['{{SHORT}}', '{{LONG}}'], {
      SHORT: 'secret',
      LONG: 'secret-suffix',
    })

    expect(sanitize('secret-suffix secret')).toBe('{{LONG}} {{SHORT}}')
  })

  it('uses the lexicographically first name for duplicate values', () => {
    const sanitize = createEnvironmentSecretSanitizer(['{{Z_SECRET}}', '{{A_SECRET}}'], {
      Z_SECRET: 'same-value',
      A_SECRET: 'same-value',
    })

    expect(sanitize('same-value')).toBe('{{A_SECRET}}')
  })

  it('does not re-sanitize placeholders inserted earlier in the same string', () => {
    const sanitize = createEnvironmentSecretSanitizer(['{{A_SECRET}}', '{{B_SECRET}}'], {
      A_SECRET: 'secret-value',
      B_SECRET: 'A_SECRET',
    })

    expect(sanitize('secret-value A_SECRET')).toBe('{{A_SECRET}} {{B_SECRET}}')
  })

  it('handles special object keys without changing the object prototype', () => {
    const source = Object.create(null) as Record<string, unknown>
    Object.defineProperty(source, '__proto__', {
      value: 'secret',
      enumerable: true,
      configurable: true,
      writable: true,
    })
    source.constructor = 'secret'
    const sanitize = createEnvironmentSecretSanitizer('{{SECRET}}', { SECRET: 'secret' })

    const sanitized = sanitize(source)

    expect(Object.getPrototypeOf(sanitized)).toBeNull()
    expect(Object.keys(sanitized)).toEqual(['__proto__', 'constructor'])
    expect(sanitized.__proto__).toBe('{{SECRET}}')
    expect(sanitized.constructor).toBe('{{SECRET}}')
  })

  it('leaves non-plain runtime objects unchanged', () => {
    const date = new Date()
    const sanitize = createEnvironmentSecretSanitizer('{{SECRET}}', { SECRET: 'secret' })

    expect(sanitize(date)).toBe(date)
  })

  it('finds references in nested configuration keys and tolerates cycles', () => {
    const configured: Record<string, unknown> = {}
    configured['prefix-{{SECRET}}'] = configured
    const source: Record<string, unknown> = { value: 'secret' }
    source.self = source
    const sanitize = createEnvironmentSecretSanitizer(configured, { SECRET: 'secret' })

    const sanitized = sanitize(source)

    expect(sanitized.value).toBe('{{SECRET}}')
    expect(sanitized.self).toBe(sanitized)
  })
})
