import {
  getRegistrationPolicy,
  REGISTRATION_MODES,
  type RegistrationModeInput,
  resolveRegistrationMode,
} from '@sim/deployment-config/registration'
import { describe, expect, it } from 'vitest'

function resolve(input: Partial<RegistrationModeInput> = {}) {
  return resolveRegistrationMode({ mode: undefined, legacy: {}, ...input })
}

function codes(input: Partial<RegistrationModeInput>) {
  return resolve(input).warnings.map((warning) => warning.code)
}

describe('resolveRegistrationMode', () => {
  it('defaults to open with nothing configured', () => {
    expect(resolve()).toEqual({ mode: 'open', warnings: [] })
  })

  it('treats an empty value, as Helm renders an unset key, as unset', () => {
    expect(resolve({ mode: '' })).toEqual({ mode: 'open', warnings: [] })
    expect(resolve({ mode: '  ' })).toEqual({ mode: 'open', warnings: [] })
  })

  it.each(REGISTRATION_MODES)('accepts %s as configured', (mode) => {
    expect(resolve({ mode })).toEqual({ mode, warnings: [] })
  })

  it('closes registration on an unknown value without disabling email sign-in', () => {
    const resolved = resolve({ mode: 'disabled' })

    expect(resolved.mode).toBe('closed')
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: 'invalid-mode', severity: 'error' }),
    ])
  })

  it('does not accept a boolean-looking value as a mode', () => {
    expect(resolve({ mode: 'true' }).mode).toBe('closed')
  })

  it('accepts a mode in any case without reporting it invalid', () => {
    expect(resolve({ mode: 'CLOSED' })).toEqual({ mode: 'closed', warnings: [] })
  })

  it('accepts a mode with surrounding whitespace', () => {
    expect(resolve({ mode: ' no-email ' })).toEqual({ mode: 'no-email', warnings: [] })
  })

  describe('deprecated values written in another case or padded', () => {
    it('reads DISABLE_REGISTRATION=TRUE as closed', () => {
      expect(resolve({ legacy: { disableRegistration: 'TRUE' } }).mode).toBe('closed')
    })

    it('reads EMAIL_PASSWORD_SIGNUP_ENABLED=" FALSE " as no-email', () => {
      expect(resolve({ legacy: { emailPasswordSignupEnabled: ' FALSE ' } }).mode).toBe('no-email')
    })
  })

  describe('deprecated variables alone', () => {
    it('maps DISABLE_REGISTRATION to closed', () => {
      const resolved = resolve({ legacy: { disableRegistration: 'true' } })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings).toEqual([
        expect.objectContaining({ code: 'deprecated-variables', severity: 'warn' }),
      ])
    })

    it('maps DISABLE_EMAIL_SIGNUP to no-email-signup', () => {
      expect(resolve({ legacy: { disableEmailSignup: '1' } }).mode).toBe('no-email-signup')
    })

    it('maps EMAIL_PASSWORD_SIGNUP_ENABLED=false to no-email', () => {
      expect(resolve({ legacy: { emailPasswordSignupEnabled: 'false' } }).mode).toBe('no-email')
    })

    it('maps the browser twin alone to no-email', () => {
      expect(resolve({ legacy: { publicEmailPasswordSignupEnabled: 'false' } }).mode).toBe(
        'no-email'
      )
    })

    it('keeps the twin restriction when the server variable says true', () => {
      expect(
        resolve({
          legacy: { emailPasswordSignupEnabled: 'true', publicEmailPasswordSignupEnabled: '0' },
        }).mode
      ).toBe('no-email')
    })

    it('maps DISABLE_REGISTRATION with EMAIL_PASSWORD_SIGNUP_ENABLED=false to closed-no-email', () => {
      expect(
        resolve({ legacy: { disableRegistration: 'true', emailPasswordSignupEnabled: 'false' } })
          .mode
      ).toBe('closed-no-email')
    })

    it('lets DISABLE_REGISTRATION absorb DISABLE_EMAIL_SIGNUP', () => {
      expect(
        resolve({ legacy: { disableRegistration: 'true', disableEmailSignup: 'true' } }).mode
      ).toBe('closed')
    })

    it('lets EMAIL_PASSWORD_SIGNUP_ENABLED=false absorb DISABLE_EMAIL_SIGNUP', () => {
      expect(
        resolve({ legacy: { disableEmailSignup: 'true', emailPasswordSignupEnabled: 'false' } })
          .mode
      ).toBe('no-email')
    })

    it('reads booleans as well as strings', () => {
      expect(
        resolve({ legacy: { disableRegistration: true, emailPasswordSignupEnabled: false } }).mode
      ).toBe('closed-no-email')
    })

    it('warns about a deprecated variable that restricts nothing but changes no mode', () => {
      const resolved = resolve({ legacy: { disableRegistration: 'false' } })

      expect(resolved.mode).toBe('open')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual(['deprecated-variables'])
    })
  })

  describe('REGISTRATION_MODE with deprecated variables', () => {
    it('keeps a legacy restriction an open mode would lift', () => {
      const resolved = resolve({ mode: 'open', legacy: { disableRegistration: 'true' } })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual([
        'deprecated-variables',
        'conflict',
      ])
    })

    it('keeps a mode restriction the legacy variables would lift', () => {
      const resolved = resolve({ mode: 'closed', legacy: { emailPasswordSignupEnabled: 'true' } })

      expect(resolved.mode).toBe('closed')
      expect(resolved.warnings.map((warning) => warning.code)).toEqual(['deprecated-variables'])
    })

    it('takes the most restrictive value on each axis', () => {
      expect(
        resolve({ mode: 'closed', legacy: { emailPasswordSignupEnabled: 'false' } }).mode
      ).toBe('closed-no-email')
      expect(resolve({ mode: 'no-email', legacy: { disableRegistration: 'true' } }).mode).toBe(
        'closed-no-email'
      )
      expect(resolve({ mode: 'no-email-signup', legacy: { disableRegistration: '1' } }).mode).toBe(
        'closed'
      )
    })

    it('does not report a conflict when both agree', () => {
      expect(codes({ mode: 'closed', legacy: { disableRegistration: 'true' } })).toEqual([
        'deprecated-variables',
      ])
    })

    it('combines an unknown mode with a legacy email restriction', () => {
      const resolved = resolve({ mode: 'nope', legacy: { emailPasswordSignupEnabled: 'false' } })

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
