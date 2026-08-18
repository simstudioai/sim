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

  it('ignores a dotless name, which strict relays reject just like the literal', () => {
    setEnv({ SMTP_EHLO_NAME: 'sim-app' })
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it('ignores a name carrying CRLF rather than passing it into the EHLO command', () => {
    setEnv({ SMTP_EHLO_NAME: 'evil.com\r\nMAIL FROM:<attacker@evil.com>' })
    expect(getSmtpEhloName()).toBe('sim.example.com')
  })

  it("returns undefined when the app domain carries a port, leaving nodemailer's default", () => {
    urlsMockFns.mockGetEmailDomain.mockReturnValue('localhost:3000')
    expect(getSmtpEhloName()).toBeUndefined()
  })

  it('returns undefined when neither source yields a qualified name', () => {
    setEnv({ SMTP_EHLO_NAME: 'localhost' })
    urlsMockFns.mockGetEmailDomain.mockReturnValue('localhost')
    expect(getSmtpEhloName()).toBeUndefined()
  })
})
