/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { resetEnvMock, setEnv } from '@sim/testing'
import { NextResponse } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import {
  type DeploymentAuthResource,
  deploymentAuthCookieName,
  isEmailAllowed,
  readDeploymentAuthToken,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'

const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(() => {
  setEnv({ ENCRYPTION_KEY: '0'.repeat(64) })
})

afterAll(resetEnvMock)

async function mintToken(
  resource: DeploymentAuthResource,
  verifiedEmail?: string
): Promise<string> {
  const response = NextResponse.json({})
  await setDeploymentAuthCookie({
    response,
    cookiePrefix: 'file',
    resource,
    verifiedEmail,
  })
  const token = response.cookies.get(deploymentAuthCookieName('file', resource.id))?.value
  if (!token) throw new Error('Expected deployment auth cookie')
  return token
}

function withoutEncryptedEmailClaim(token: string): string {
  const [encodedPayload] = token.split('.')
  if (!encodedPayload) throw new Error('Expected encoded deployment auth payload')
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  payload.encryptedEmail = undefined
  const encodedLegacyPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = hmacSha256Hex(encodedLegacyPayload, env.BETTER_AUTH_SECRET)
  return `${encodedLegacyPayload}.${signature}`
}

describe('deployment auth tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds a password token to the resource, auth mode, and current password', async () => {
    const resource = {
      id: 'share-1',
      authType: 'password',
      password: 'encrypted-password-1',
    }
    const token = await mintToken(resource)

    await expect(validateAuthToken({ token, resource })).resolves.toBe(true)
    await expect(
      validateAuthToken({ token, resource: { ...resource, id: 'share-2' } })
    ).resolves.toBe(false)
    await expect(
      validateAuthToken({ token, resource: { ...resource, authType: 'email' } })
    ).resolves.toBe(false)
    await expect(
      validateAuthToken({
        token,
        resource: { ...resource, password: 'encrypted-password-2' },
      })
    ).resolves.toBe(false)
    await expect(readDeploymentAuthToken({ token, resource })).resolves.toEqual({})
  })

  it('round-trips a normalized email without exposing it in the signed payload', async () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['person@example.com'],
    }
    const token = await mintToken(resource, ' Person@Example.com ')
    const [encodedPayload] = token.split('.')
    const decodedPayload = Buffer.from(encodedPayload, 'base64url').toString('utf8')

    expect(decodedPayload).not.toContain('person')
    expect(decodedPayload).not.toContain('example.com')
    await expect(readDeploymentAuthToken({ token, resource })).resolves.toEqual({
      authenticatedEmail: 'person@example.com',
    })
  })

  it('accepts a rollout token without inventing an email identity', async () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['viewer@example.test'],
    }
    const token = withoutEncryptedEmailClaim(await mintToken(resource, 'viewer@example.test'))

    await expect(readDeploymentAuthToken({ token, resource })).resolves.toEqual({})
  })

  it('revokes an exact-address email token as soon as that address is removed', async () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['viewer@example.test', 'other@example.test'],
    }
    const token = await mintToken(resource, 'Viewer@Example.Test')

    await expect(validateAuthToken({ token, resource })).resolves.toBe(true)
    await expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['other@example.test'] },
      })
    ).resolves.toBe(false)
  })

  it('keeps an email token valid while its exact or domain grant remains current', async () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['viewer@example.test'],
    }
    const token = await mintToken(resource, 'viewer@example.test')

    await expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['new@example.test', 'viewer@example.test'] },
      })
    ).resolves.toBe(true)
    await expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['@example.test'] },
      })
    ).resolves.toBe(true)
  })

  it('revokes a domain-granted token when the domain is removed', async () => {
    const resource = {
      id: 'share-1',
      authType: 'email',
      password: null,
      allowedEmails: ['@example.test'],
    }
    const token = await mintToken(resource, 'viewer@example.test')

    await expect(validateAuthToken({ token, resource })).resolves.toBe(true)
    await expect(
      validateAuthToken({
        token,
        resource: { ...resource, allowedEmails: ['@other.test'] },
      })
    ).resolves.toBe(false)
  })

  it('rejects expired, future-dated, malformed, and legacy tokens', async () => {
    const now = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const resource = {
      id: 'share-1',
      authType: 'password',
      password: 'encrypted-password-1',
    }
    const token = await mintToken(resource)

    nowSpy.mockReturnValue(now + DAY_MS + 1)
    await expect(validateAuthToken({ token, resource })).resolves.toBe(false)
    nowSpy.mockReturnValue(now - 60_001)
    await expect(validateAuthToken({ token, resource })).resolves.toBe(false)
    await expect(validateAuthToken({ token: `${token}tampered`, resource })).resolves.toBe(false)
    await expect(validateAuthToken({ token: 'legacy-token', resource })).resolves.toBe(false)
  })

  it('requires the credential that corresponds to the selected auth mode', async () => {
    const response = NextResponse.json({})

    await expect(
      setDeploymentAuthCookie({
        response,
        cookiePrefix: 'chat',
        resource: { id: 'chat-1', authType: 'email', allowedEmails: ['viewer@example.test'] },
      })
    ).rejects.toThrow('verified email')
    await expect(
      setDeploymentAuthCookie({
        response,
        cookiePrefix: 'chat',
        resource: { id: 'chat-1', authType: 'password', password: null },
      })
    ).rejects.toThrow('configured password')
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
