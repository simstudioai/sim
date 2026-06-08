import { createHash, createHmac } from 'node:crypto'
import { createEnvMock } from '@sim/testing'
import type { NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    BETTER_AUTH_SECRET: 'deployment-auth-test-secret-32-chars',
  })
)

vi.mock('@/lib/core/config/feature-flags', () => ({
  isDev: true,
}))

import { setDeploymentAuthCookie, validateAuthToken } from './deployment'

const SECRET = 'deployment-auth-test-secret-32-chars'

function issueCookieToken(encryptedPassword?: string | null): string {
  let token = ''
  const response = {
    cookies: {
      set: vi.fn((cookie: { value: string }) => {
        token = cookie.value
      }),
    },
  } as unknown as NextResponse

  setDeploymentAuthCookie(response, 'chat', 'dep_test', 'password', encryptedPassword)

  return token
}

function forgeUnsignedLegacyToken(
  deploymentId: string,
  encryptedPassword: string,
  timestamp = Date.now()
): string {
  const passwordSlot = createHash('sha256').update(encryptedPassword).digest('hex').slice(0, 8)
  return Buffer.from(`${deploymentId}:password:${timestamp}:${passwordSlot}`).toString('base64')
}

function signedLegacyToken(
  deploymentId: string,
  encryptedPassword: string,
  timestamp = Date.now()
): string {
  const passwordSlot = createHash('sha256').update(encryptedPassword).digest('hex').slice(0, 8)
  const payload = `${deploymentId}:password:${timestamp}:${passwordSlot}`
  const signature = createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex')

  return Buffer.from(`${payload}:${signature}`).toString('base64')
}

function signedV2Token(
  deploymentId: string,
  encryptedPassword: string,
  timestamp = Date.now()
): string {
  const payload = `v2:${deploymentId}:password:${timestamp}`
  const passwordBinding = createHash('sha256').update(encryptedPassword, 'utf8').digest('hex')
  const signature = createHmac('sha256', SECRET)
    .update(`${payload}:${passwordBinding}`, 'utf8')
    .digest('hex')

  return Buffer.from(`${payload}:${signature}`).toString('base64')
}

describe('deployment auth tokens', () => {
  it('validates signed server-issued tokens', () => {
    const token = issueCookieToken('encrypted-password')

    expect(validateAuthToken(token, 'dep_test', 'encrypted-password')).toBe(true)
    expect(validateAuthToken(token, 'other-deployment', 'encrypted-password')).toBe(false)
  })

  it('does not expose the password-derived slot in newly issued tokens', () => {
    const token = issueCookieToken('encrypted-password')
    const decoded = Buffer.from(token, 'base64').toString()

    expect(decoded).toMatch(/^v2:dep_test:password:\d+:[a-f0-9]{64}$/)
    expect(decoded).not.toContain(
      createHash('sha256').update('encrypted-password').digest('hex').slice(0, 8)
    )
  })

  it('rejects unsigned forged tokens using the old base64 field format', () => {
    const token = forgeUnsignedLegacyToken('dep_test', 'encrypted-password')

    expect(validateAuthToken(token, 'dep_test', 'encrypted-password')).toBe(false)
  })

  it('rejects signed tokens after the deployment password changes', () => {
    const token = issueCookieToken('encrypted-password')

    expect(validateAuthToken(token, 'dep_test', 'different-encrypted-password')).toBe(false)
  })

  it('rejects tampered signed token payloads', () => {
    const token = issueCookieToken('encrypted-password')
    const decoded = Buffer.from(token, 'base64').toString()
    const tampered = Buffer.from(decoded.replace('dep_test', 'other-deployment')).toString('base64')

    expect(validateAuthToken(tampered, 'other-deployment', 'encrypted-password')).toBe(false)
  })

  it('rejects expired signed tokens', () => {
    const expiredTimestamp = Date.now() - 24 * 60 * 60 * 1000 - 1
    const token = signedV2Token('dep_test', 'encrypted-password', expiredTimestamp)

    expect(validateAuthToken(token, 'dep_test', 'encrypted-password')).toBe(false)
  })

  it('accepts signed legacy tokens during the 24 hour cookie window', () => {
    const token = signedLegacyToken('dep_test', 'encrypted-password')

    expect(validateAuthToken(token, 'dep_test', 'encrypted-password')).toBe(true)
  })
})
