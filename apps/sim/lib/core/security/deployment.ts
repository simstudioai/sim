import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { hmacSha256Hex } from '@sim/security/hmac'
import type { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { isDev } from '@/lib/core/config/feature-flags'

/**
 * Shared authentication utilities for deployed chat and form endpoints.
 * Handles token generation, validation, and auth cookies. CORS for these
 * endpoints lives in proxy.ts as the single source of truth.
 */

const AUTH_TOKEN_VERSION = 'v2'
const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function passwordBinding(encryptedPassword?: string | null): string {
  if (!encryptedPassword) return ''
  return sha256Hex(encryptedPassword)
}

function signPayload(payload: string, encryptedPassword?: string | null): string {
  return hmacSha256Hex(`${payload}:${passwordBinding(encryptedPassword)}`, env.BETTER_AUTH_SECRET)
}

function signLegacyPayload(payload: string): string {
  return hmacSha256Hex(payload, env.BETTER_AUTH_SECRET)
}

function passwordSlot(encryptedPassword?: string | null): string {
  if (!encryptedPassword) return ''
  return sha256Hex(encryptedPassword).slice(0, 8)
}

function generateAuthToken(
  deploymentId: string,
  type: string,
  encryptedPassword?: string | null
): string {
  const payload = `${AUTH_TOKEN_VERSION}:${deploymentId}:${type}:${Date.now()}`
  const sig = signPayload(payload, encryptedPassword)
  return Buffer.from(`${payload}:${sig}`).toString('base64')
}

function hasValidTimestamp(timestamp: string): boolean {
  const createdAt = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(createdAt)) return false

  return Date.now() - createdAt <= AUTH_TOKEN_TTL_MS
}

/**
 * Validates an HMAC-signed authentication token for a deployment (chat or form).
 * The signature is bound to the current encrypted password so changing a
 * deployment password immediately invalidates existing sessions.
 */
export function validateAuthToken(
  token: string,
  deploymentId: string,
  encryptedPassword?: string | null
): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const lastColon = decoded.lastIndexOf(':')
    if (lastColon === -1) return false

    const payload = decoded.slice(0, lastColon)
    const sig = decoded.slice(lastColon + 1)

    const parts = payload.split(':')

    if (parts[0] === AUTH_TOKEN_VERSION) {
      if (parts.length !== 4) return false

      const expectedSig = signPayload(payload, encryptedPassword)
      if (!safeCompare(sig, expectedSig)) return false

      const [_version, storedId, _type, timestamp] = parts
      if (storedId !== deploymentId) return false

      return hasValidTimestamp(timestamp)
    }

    if (parts.length !== 4) return false

    const expectedSig = signLegacyPayload(payload)
    if (!safeCompare(sig, expectedSig)) return false

    const [storedId, _type, timestamp, storedPwSlot] = parts
    if (storedId !== deploymentId) return false

    const expectedPwSlot = passwordSlot(encryptedPassword)
    if (storedPwSlot !== expectedPwSlot) return false

    return hasValidTimestamp(timestamp)
  } catch (_e) {
    return false
  }
}

/**
 * Sets an authentication cookie for a deployment
 */
export function setDeploymentAuthCookie(
  response: NextResponse,
  cookiePrefix: 'chat' | 'form',
  deploymentId: string,
  authType: string,
  encryptedPassword?: string | null
): void {
  const token = generateAuthToken(deploymentId, authType, encryptedPassword)
  response.cookies.set({
    name: `${cookiePrefix}_auth_${deploymentId}`,
    value: token,
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
}

/**
 * Checks if an email matches the allowed emails list (exact match or domain match)
 */
export function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
  if (allowedEmails.includes(email)) {
    return true
  }

  const atIndex = email.indexOf('@')
  if (atIndex > 0) {
    const domain = email.substring(atIndex + 1)
    if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
      return true
    }
  }

  return false
}
