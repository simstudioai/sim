/**
 * @vitest-environment node
 */
import { resetEnvMock, resetUrlsMock, setEnv, urlsMockFns } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getSmtpEhloName } from '@/lib/messaging/email/ehlo'

afterAll(() => {
  resetEnvMock()
  resetUrlsMock()
})

beforeEach(() => {
  resetEnvMock()
  setEnv({ SMTP_EHLO_NAME: undefined })
  urlsMockFns.mockGetEmailDomain.mockReturnValue('sim.example.com')
})

describe('getSmtpEhloName', () => {
  it("falls back to the app's own domain so k8s pods never greet as [127.0.0.1]", () => {
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it('prefers an explicitly configured SMTP_EHLO_NAME', () => {
    setEnv({ SMTP_EHLO_NAME: 'mail.yourdomain.com' })
    expect(getSmtpEhloName()).toBe('mail.yourdomain.com')
  })

  it('trims surrounding whitespace', () => {
    setEnv({ SMTP_EHLO_NAME: '  mail.yourdomain.com  ' })
    expect(getSmtpEhloName()).toBe('mail.yourdomain.com')
  })

  it('accepts an RFC 5321 address literal', () => {
    setEnv({ SMTP_EHLO_NAME: '[203.0.113.5]' })
    expect(getSmtpEhloName()).toBe('[203.0.113.5]')
  })

  it.each(['[IPv6:2001:db8::1]', '[ipv6:2001:db8::1]', '[IPV6:2001:db8::1]'])(
    'accepts the RFC 5321 IPv6 address literal %s, whose tag is case-insensitive',
    (literal) => {
      setEnv({ SMTP_EHLO_NAME: literal })
      expect(getSmtpEhloName()).toBe(literal)
    }
  )

  it.each(['[::::]', '[13]', '[999.1.1.1]', '[2001:db8::1]', '[IPv6:203.0.113.5]'])(
    'ignores the malformed address literal %s rather than letting the relay refuse it',
    (literal) => {
      setEnv({ SMTP_EHLO_NAME: literal })
      expect(getSmtpEhloName()).toBe('sim.example.com')
    }
  )

  it('ignores a dotless name, which strict relays reject just like the literal', () => {
    setEnv({ SMTP_EHLO_NAME: 'sim-app' })
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it('ignores a name carrying CRLF rather than passing it into the EHLO command', () => {
    setEnv({ SMTP_EHLO_NAME: 'evil.com\r\nMAIL FROM:<attacker@evil.com>' })
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it('strips a port from the app domain instead of falling back over it', () => {
    urlsMockFns.mockGetEmailDomain.mockReturnValue('sim.example.com:8443')
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it("returns undefined for a dev app domain, leaving nodemailer's default", () => {
    urlsMockFns.mockGetEmailDomain.mockReturnValue('localhost:3000')
    expect(getSmtpEhloName()).toBeUndefined()
  })

  it('returns undefined when neither source yields a qualified name', () => {
    setEnv({ SMTP_EHLO_NAME: 'localhost' })
    urlsMockFns.mockGetEmailDomain.mockReturnValue('localhost')
    expect(getSmtpEhloName()).toBeUndefined()
  })
})
