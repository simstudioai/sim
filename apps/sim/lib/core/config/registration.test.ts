import {
  getRegistrationPolicy,
  REGISTRATION_MODES,
  resolveRegistrationMode,
} from '@sim/deployment-config/registration'
import { describe, expect, it } from 'vitest'

/** Resolves against an environment holding exactly `vars`. */
function resolve(vars: Record<string, string> = {}) {
  const env = new Map(Object.entries(vars))
  return resolveRegistrationMode((name) => env.get(name))
}

function codes(vars: Record<string, string>) {
  return resolve(vars).warnings.map((warning) => warning.code)
}

describe('resolveRegistrationMode', () => {
  it('defaults to open with nothing configured', () => {
    expect(resolve()).toEqual({ mode: 'open', warnings: [] })
  })

  it('treats an empty value, as Helm renders an unset key, as unset', () => {
    expect(resolve({ REGISTRATION_MODE: '' })).toEqual({ mode: 'open', warnings: [] })
    expect(resolve({ REGISTRATION_MODE: '  ' })).toEqual({ mode: 'open', warnings: [] })
  })

  it.each(REGISTRATION_MODES)('accepts %s as configured', (mode) => {
    expect(resolve({ REGISTRATION_MODE: mode })).toEqual({ mode, warnings: [] })
  })

  it('closes registration on an unknown value without disabling email sign-in', () => {
    const resolved = resolve({ REGISTRATION_MODE: 'disabled' })

    expect(resolved.mode).toBe('closed')
    expect(resolved.warnings).toEqual([expect.objectContaining({ code: 'invalid-mode' })])
  })

  it('does not accept a boolean-looking value as a mode', () => {
    expect(resolve({ REGISTRATION_MODE: 'true' }).mode).toBe('closed')
  })

  it('accepts a mode in any case without reporting it invalid', () => {
    expect(resolve({ REGISTRATION_MODE: 'CLOSED' })).toEqual({ mode: 'closed', warnings: [] })
  })

  it('accepts a mode with surrounding whitespace', () => {
    expect(resolve({ REGISTRATION_MODE: ' no-email ' })).toEqual({ mode: 'no-email', warnings: [] })
  })

  describe('deprecated values written in another case or padded', () => {
    it('reads DISABLE_REGISTRATION=TRUE as closed', () => {
      expect(resolve({ DISABLE_REGISTRATION: 'TRUE' }).mode).toBe('closed')
    })

    it('reads EMAIL_PASSWORD_SIGNUP_ENABLED=" FALSE " as no-email', () => {
      expect(resolve({ EMAIL_PASSWORD_SIGNUP_ENABLED: ' FALSE ' }).mode).toBe('no-email')
    })
  })

  describe('deprecated variables alone', () => {
    it('maps DISABLE_REGISTRATION to closed', () => {
      const resolved = resolve({ DISABLE_REGISTRATION: 'true' })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings).toEqual([expect.objectContaining({ code: 'deprecated-variables' })])
    })

    it('maps DISABLE_EMAIL_SIGNUP to no-email-signup', () => {
      expect(resolve({ DISABLE_EMAIL_SIGNUP: '1' }).mode).toBe('no-email-signup')
    })

    it('maps EMAIL_PASSWORD_SIGNUP_ENABLED=false to no-email', () => {
      expect(resolve({ EMAIL_PASSWORD_SIGNUP_ENABLED: 'false' }).mode).toBe('no-email')
    })

    it('maps the browser twin alone to no-email', () => {
      expect(resolve({ NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED: 'false' }).mode).toBe('no-email')
    })

    it('keeps the twin restriction when the server variable says true', () => {
      expect(
        resolve({
          EMAIL_PASSWORD_SIGNUP_ENABLED: 'true',
          NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED: '0',
        }).mode
      ).toBe('no-email')
    })

    it('maps DISABLE_REGISTRATION with EMAIL_PASSWORD_SIGNUP_ENABLED=false to closed-no-email', () => {
      expect(
        resolve({ DISABLE_REGISTRATION: 'true', EMAIL_PASSWORD_SIGNUP_ENABLED: 'false' }).mode
      ).toBe('closed-no-email')
    })

    it('lets DISABLE_REGISTRATION absorb DISABLE_EMAIL_SIGNUP', () => {
      expect(resolve({ DISABLE_REGISTRATION: 'true', DISABLE_EMAIL_SIGNUP: 'true' }).mode).toBe(
        'closed'
      )
    })

    it('lets EMAIL_PASSWORD_SIGNUP_ENABLED=false absorb DISABLE_EMAIL_SIGNUP', () => {
      expect(
        resolve({ DISABLE_EMAIL_SIGNUP: 'true', EMAIL_PASSWORD_SIGNUP_ENABLED: 'false' }).mode
      ).toBe('no-email')
    })

    it('warns about a deprecated variable that restricts nothing but changes no mode', () => {
      const resolved = resolve({ DISABLE_REGISTRATION: 'false' })

      expect(resolved.mode).toBe('open')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual(['deprecated-variables'])
    })
  })

  describe('REGISTRATION_MODE with deprecated variables', () => {
    it('keeps a legacy restriction an open mode would lift', () => {
      const resolved = resolve({ REGISTRATION_MODE: 'open', DISABLE_REGISTRATION: 'true' })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual([
        'deprecated-variables',
        'conflict',
      ])
    })

    it('keeps a mode restriction the legacy variables would lift', () => {
      const resolved = resolve({
        REGISTRATION_MODE: 'closed',
        EMAIL_PASSWORD_SIGNUP_ENABLED: 'true',
      })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual(['deprecated-variables'])
    })

    it('takes the most restrictive value on each axis', () => {
      expect(
        resolve({ REGISTRATION_MODE: 'closed', EMAIL_PASSWORD_SIGNUP_ENABLED: 'false' }).mode
      ).toBe('closed-no-email')
      expect(resolve({ REGISTRATION_MODE: 'no-email', DISABLE_REGISTRATION: 'true' }).mode).toBe(
        'closed-no-email'
      )
      expect(
        resolve({ REGISTRATION_MODE: 'no-email-signup', DISABLE_REGISTRATION: '1' }).mode
      ).toBe('closed')
    })

    it('does not report a conflict when both agree', () => {
      expect(codes({ REGISTRATION_MODE: 'closed', DISABLE_REGISTRATION: 'true' })).toEqual([
        'deprecated-variables',
      ])
    })

    it('combines an unknown mode with a legacy email restriction', () => {
      const resolved = resolve({
        REGISTRATION_MODE: 'nope',
        EMAIL_PASSWORD_SIGNUP_ENABLED: 'false',
      })

      expect(resolved.mode).toBe('closed-no-email')
      expect(resolved.warnings[0]).toEqual(expect.objectContaining({ code: 'invalid-mode' }))
    })
  })
})

describe('getRegistrationPolicy', () => {
  it.each([
    ['open', false, true, true],
    ['no-email-signup', false, false, true],
    ['closed', true, false, true],
    ['no-email', false, false, false],
    ['closed-no-email', true, false, false],
  ] as const)(
    '%s',
    (mode, selfServeRegistrationClosed, emailSignupAllowed, emailPasswordAuthEnabled) => {
      expect(getRegistrationPolicy(mode)).toEqual({
        selfServeRegistrationClosed,
        emailSignupAllowed,
        emailPasswordAuthEnabled,
      })
    }
  )
})
