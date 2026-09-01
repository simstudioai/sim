import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { hmacSha256Hex } from '@sim/security/hmac'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import type { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { isDev } from '@/lib/core/config/env-flags'

const DEPLOYMENT_AUTH_TOKEN_VERSION = 1
const DEPLOYMENT_AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const DEPLOYMENT_AUTH_TOKEN_CLOCK_SKEW_MS = 60 * 1000
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

/** The kind of deployed resource an auth cookie/token belongs to. */
export type DeploymentAuthKind = 'chat' | 'file'

/** The current auth-policy fields needed to mint or validate a deployment cookie. */
export interface DeploymentAuthResource {
  id: string
  authType: string | null
  password?: string | null
  allowedEmails?: unknown
}

interface DeploymentAuthTokenBase {
  version: typeof DEPLOYMENT_AUTH_TOKEN_VERSION
  resourceId: string
  issuedAt: number
}

interface PasswordAuthTokenPayload extends DeploymentAuthTokenBase {
  authType: 'password'
  passwordSlot: string
}

interface EmailAuthTokenPayload extends DeploymentAuthTokenBase {
  authType: 'email'
  emailSlot: string
  emailDomainSlot: string
}

type DeploymentAuthTokenPayload = PasswordAuthTokenPayload | EmailAuthTokenPayload

interface EmailGrant {
  kind: 'email' | 'domain'
  value: string
}

interface ValidateAuthTokenParams {
  token: string
  resource: DeploymentAuthResource
}

interface SetDeploymentAuthCookieParams {
  response: NextResponse
  cookiePrefix: DeploymentAuthKind
  resource: DeploymentAuthResource
  verifiedEmail?: string
}

function signPayload(payload: string): string {
  return hmacSha256Hex(payload, env.BETTER_AUTH_SECRET)
}

function passwordSlot(encryptedPassword: string): string {
  return sha256Hex(encryptedPassword)
}

function identitySlot(kind: 'email' | 'domain', value: string): string {
  return hmacSha256Hex(`deployment-auth:${kind}:${value}`, env.BETTER_AUTH_SECRET)
}

function emailIdentitySlots(
  email: string
): Pick<EmailAuthTokenPayload, 'emailSlot' | 'emailDomainSlot'> {
  const normalizedEmail = normalizeEmail(email)
  if (!isValidEmailSyntax(normalizedEmail)) {
    throw new Error('Cannot create deployment auth token for an invalid email address')
  }

  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1)
  return {
    emailSlot: identitySlot('email', normalizedEmail),
    emailDomainSlot: identitySlot('domain', domain),
  }
}

function emailGrants(allowedEmails: unknown): EmailGrant[] {
  if (!Array.isArray(allowedEmails)) return []

  const grants: EmailGrant[] = []
  for (const entry of allowedEmails) {
    if (typeof entry !== 'string') continue
    const normalizedEntry = normalizeEmail(entry)
    if (normalizedEntry.startsWith('@')) {
      if (isValidEmailSyntax(normalizedEntry, true)) {
        grants.push({ kind: 'domain', value: normalizedEntry.slice(1) })
      }
    } else if (isValidEmailSyntax(normalizedEntry)) {
      grants.push({ kind: 'email', value: normalizedEntry })
    }
  }
  return grants
}

function generateAuthToken(resource: DeploymentAuthResource, verifiedEmail?: string): string {
  const base = {
    version: DEPLOYMENT_AUTH_TOKEN_VERSION,
    resourceId: resource.id,
    issuedAt: Date.now(),
  } as const

  let payload: DeploymentAuthTokenPayload
  if (resource.authType === 'password') {
    if (!resource.password) {
      throw new Error('Cannot create password auth token without a configured password')
    }
    payload = {
      ...base,
      authType: 'password',
      passwordSlot: passwordSlot(resource.password),
    }
  } else if (resource.authType === 'email') {
    if (!verifiedEmail) {
      throw new Error('Cannot create email auth token without a verified email address')
    }
    payload = {
      ...base,
      authType: 'email',
      ...emailIdentitySlots(verifiedEmail),
    }
  } else {
    throw new Error(`Cannot create auth token for unsupported auth type: ${resource.authType}`)
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

function isDeploymentAuthTokenPayload(value: unknown): value is DeploymentAuthTokenPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  if (
    payload.version !== DEPLOYMENT_AUTH_TOKEN_VERSION ||
    typeof payload.resourceId !== 'string' ||
    payload.resourceId.length === 0 ||
    typeof payload.issuedAt !== 'number' ||
    !Number.isSafeInteger(payload.issuedAt)
  ) {
    return false
  }

  if (payload.authType === 'password') {
    return isSha256Hex(payload.passwordSlot)
  }
  if (payload.authType === 'email') {
    return isSha256Hex(payload.emailSlot) && isSha256Hex(payload.emailDomainSlot)
  }
  return false
}

function isEmailTokenAllowed(payload: EmailAuthTokenPayload, allowedEmails: unknown): boolean {
  return emailGrants(allowedEmails).some((grant) => {
    const tokenSlot = grant.kind === 'domain' ? payload.emailDomainSlot : payload.emailSlot
    return safeCompare(tokenSlot, identitySlot(grant.kind, grant.value))
  })
}

/**
 * Validates a signed deployment cookie against the resource's current auth policy.
 * Email tokens carry HMAC-derived identity slots so allow-list removals take effect
 * immediately without exposing the verified address in the cookie.
 */
export function validateAuthToken({ token, resource }: ValidateAuthTokenParams): boolean {
  try {
    const [encodedPayload, signature, extra] = token.split('.')
    if (!encodedPayload || !signature || extra !== undefined) return false

    const expectedSignature = signPayload(encodedPayload)
    if (!safeCompare(signature, expectedSignature)) return false

    const decoded: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!isDeploymentAuthTokenPayload(decoded)) return false
    if (decoded.resourceId !== resource.id || decoded.authType !== resource.authType) return false

    const now = Date.now()
    if (
      decoded.issuedAt > now + DEPLOYMENT_AUTH_TOKEN_CLOCK_SKEW_MS ||
      now - decoded.issuedAt > DEPLOYMENT_AUTH_TOKEN_TTL_MS
    ) {
      return false
    }

    if (decoded.authType === 'password') {
      return Boolean(
        resource.password && safeCompare(decoded.passwordSlot, passwordSlot(resource.password))
      )
    }

    return isEmailTokenAllowed(decoded, resource.allowedEmails)
  } catch {
    return false
  }
}

/** Canonical auth cookie name for a deployed resource (`{kind}_auth_{id}`). */
export function deploymentAuthCookieName(cookiePrefix: DeploymentAuthKind, id: string): string {
  return `${cookiePrefix}_auth_${id}`
}

/** Sets a signed, resource-bound authentication cookie for a deployment. */
export function setDeploymentAuthCookie({
  response,
  cookiePrefix,
  resource,
  verifiedEmail,
}: SetDeploymentAuthCookieParams): void {
  response.cookies.set({
    name: deploymentAuthCookieName(cookiePrefix, resource.id),
    value: generateAuthToken(resource, verifiedEmail),
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: DEPLOYMENT_AUTH_TOKEN_TTL_MS / 1000,
  })
}

/**
 * Checks whether an email matches an exact address or domain in an allow-list.
 * Invalid persisted entries are ignored rather than weakening or breaking the gate.
 */
export function isEmailAllowed(email: string, allowedEmails: unknown): boolean {
  const normalizedEmail = normalizeEmail(email)
  if (!isValidEmailSyntax(normalizedEmail)) return false

  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1)
  return emailGrants(allowedEmails).some((grant) => {
    return grant.kind === 'email' ? grant.value === normalizedEmail : grant.value === domain
  })
}
