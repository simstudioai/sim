import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { hmacSha256Hex } from '@sim/security/hmac'
import type { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { isDev } from '@/lib/core/config/feature-flags'

/**
 * Shared authentication utilities for deployed chat and form endpoints.
 * These functions handle token generation, validation, cookies, and CORS.
 */

function signPayload(payload: string): string {
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
  const payload = `${deploymentId}:${type}:${Date.now()}:${passwordSlot(encryptedPassword)}`
  const sig = signPayload(payload)
  return Buffer.from(`${payload}:${sig}`).toString('base64')
}

/**
 * Validates an HMAC-signed authentication token for a deployment (chat or form).
 * Includes a password-derived slot so changing the deployment password immediately
 * invalidates existing sessions.
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

    const expectedSig = signPayload(payload)
    if (!safeCompare(sig, expectedSig)) {
      return false
    }

    const parts = payload.split(':')
    if (parts.length < 4) return false
    const [storedId, _type, timestamp, storedPwSlot] = parts

    if (storedId !== deploymentId) return false

    const expectedPwSlot = passwordSlot(encryptedPassword)
    if (storedPwSlot !== expectedPwSlot) return false

    const createdAt = Number.parseInt(timestamp)
    const expireTime = 24 * 60 * 60 * 1000
    if (Date.now() - createdAt > expireTime) return false

    return true
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
 * Adds CORS headers to allow cross-origin requests for embedded deployments.
 * We reflect the requesting origin to support same-site cross-origin setups
 * (e.g. subdomains), but never set Allow-Credentials — auth cookies use
 * SameSite=Lax and are handled within same-origin iframe contexts.
 */
export function addCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = request.headers.get('origin')

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  }

  return response
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
