/**
 * @vitest-environment node
 */
import { NextResponse } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DeploymentAuthResource,
  deploymentAuthCookieName,
  isEmailAllowed,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'

const DAY_MS = 24 * 60 * 60 * 1000

function mintToken(resource: DeploymentAuthResource, verifiedEmail?: string): string {
  const response = NextResponse.json({})
  setDeploymentAuthCookie({
    response,
    cookiePrefix: 'file',
    resource,
    verifiedEmail,
  })
  const token = response.cookies.get(deploymentAuthCookieName('file', resource.id))?.value
  if (!token) throw new Error('Expected deployment auth cookie')
  return token
}

describe('deployment auth tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds a password token to the resource, auth mode, and current password', () => {
    const resource = {
      id: 'share-1',
      authType: 'password',
      password: 'encrypted-password-1',
    }
    const token = mintToken(resource)

    expect(validateAuthToken({ token, resource })).toBe(true)
    expect(validateAuthToken({ token, resource: { ...resource, id: 'share-2' } })).toBe(false)
    expect(validateAuthToken({ token, resource: { ...resource, authType: 'email' } })).toBe(false)
    expect(
      validateAuthToken({
        token,
        resource: { ...resource, password: 'encrypted-password-2' },
      })
    ).toBe(false)
  })

  it('revokes an exact-address email token as soon as that address is removed', () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['viewer@example.test', 'other@example.test'],
    }
    const token = mintToken(resource, 'Viewer@Example.Test')

    expect(validateAuthToken({ token, resource })).toBe(true)
    expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['other@example.test'] },
      })
    ).toBe(false)
  })

  it('keeps an email token valid while its exact or domain grant remains current', () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['viewer@example.test'],
    }
    const token = mintToken(resource, 'viewer@example.test')

    expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['new@example.test', 'viewer@example.test'] },
      })
    ).toBe(true)
    expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['@example.test'] },
      })
    ).toBe(true)
  })

  it('revokes a domain-granted token when the domain is removed', () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['@example.test'],
    }
    const token = mintToken(resource, 'viewer@example.test')

    expect(validateAuthToken({ token, resource })).toBe(true)
    expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['@other.test'] },
      })
    ).toBe(false)
  })

  it('does not expose the verified email address in the signed payload', () => {
    const token = mintToken(
      {
        id: 'share-1',
        authType: 'email',
        password: null,
        allowedEmails: ['viewer@example.test'],
      },
      'viewer@example.test'
    )
    const [encodedPayload] = token.split('.')
    const decodedPayload = Buffer.from(encodedPayload, 'base64url').toString('utf8')

    expect(decodedPayload).not.toContain('viewer')
    expect(decodedPayload).not.toContain('example.test')
  })

  it('rejects expired, future-dated, malformed, and legacy tokens', () => {
    const now = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const resource = {
      id: 'share-1',
      authType: 'password',
      password: 'encrypted-password-1',
    }
    const token = mintToken(resource)

    nowSpy.mockReturnValue(now + DAY_MS + 1)
    expect(validateAuthToken({ token, resource })).toBe(false)
    nowSpy.mockReturnValue(now - 60_001)
    expect(validateAuthToken({ token, resource })).toBe(false)
    expect(validateAuthToken({ token: `${token}tampered`, resource })).toBe(false)
    expect(validateAuthToken({ token: 'legacy-token', resource })).toBe(false)
  })

  it('requires the credential that corresponds to the selected auth mode', () => {
    const response = NextResponse.json({})

    expect(() =>
      setDeploymentAuthCookie({
        response,
        cookiePrefix: 'chat',
        resource: { id: 'chat-1', authType: 'email', allowedEmails: ['viewer@example.test'] },
      })
    ).toThrow('verified email')
    expect(() =>
      setDeploymentAuthCookie({
        response,
        cookiePrefix: 'chat',
        resource: { id: 'chat-1', authType: 'password', password: null },
      })
    ).toThrow('configured password')
  })
})

describe('isEmailAllowed', () => {
  it('matches an exact email regardless of casing on either side', () => {
    expect(isEmailAllowed('user@acme.com', ['user@acme.com'])).toBe(true)
    expect(isEmailAllowed('User@Acme.com', ['user@acme.com'])).toBe(true)
    expect(isEmailAllowed('user@acme.com', ['USER@ACME.COM'])).toBe(true)
    expect(isEmailAllowed('  User@Acme.com  ', ['user@acme.com'])).toBe(true)
  })

  it('matches a domain pattern regardless of casing', () => {
    expect(isEmailAllowed('User@Acme.com', ['@acme.com'])).toBe(true)
    expect(isEmailAllowed('user@acme.com', ['@Acme.com'])).toBe(true)
  })

  it('rejects invalid input and non-string persisted entries', () => {
    expect(isEmailAllowed('invalid', ['invalid'])).toBe(false)
    expect(isEmailAllowed('user@acme.com', ['user@evil.com', 123])).toBe(false)
    expect(isEmailAllowed('user@acme.com', null)).toBe(false)
  })
})
