import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import type { NextRequest } from 'next/server'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import {
  type DeploymentAuthKind,
  deploymentAuthCookieName,
  isEmailAllowed,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('DeploymentAuth')

const rateLimiter = new RateLimiter()

/**
 * Throttles unauthenticated password guesses per client IP against a single
 * deployment, mirroring the OTP/SSO IP limits.
 */
const PASSWORD_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 15 * 60_000,
}

/**
 * A password/email-gated resource (a deployed chat or a public file share). Only
 * the fields the auth check needs — the `password` is the encrypted secret.
 */
export interface DeploymentAuthResource {
  id: string
  authType: string | null
  password?: string | null
  allowedEmails?: unknown
}

interface DeploymentAuthBody {
  password?: string
  email?: string
  input?: unknown
}

export interface DeploymentAuthResult {
  authorized: boolean
  error?: string
  status?: number
  retryAfterMs?: number
}

/**
 * Shared password/email/SSO gate for deployed resources. The `cookiePrefix`
 * selects the auth cookie (`${cookiePrefix}_auth_${id}`) and the rate-limit
 * namespace so chat deployments and public file shares share one code path. Both
 * support all four modes: `'public'`, `'password'`, `'email'`, and `'sso'`.
 */
export async function validateDeploymentAuth(
  requestId: string,
  resource: DeploymentAuthResource,
  request: NextRequest,
  parsedBody: DeploymentAuthBody | null | undefined,
  cookiePrefix: DeploymentAuthKind
): Promise<DeploymentAuthResult> {
  const authType = resource.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  if (authType !== 'sso') {
    const authCookie = request.cookies.get(deploymentAuthCookieName(cookiePrefix, resource.id))

    if (
      authCookie &&
      validateAuthToken(authCookie.value, resource.id, authType, resource.password)
    ) {
      return { authorized: true }
    }
  }

  if (authType === 'password') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Password is required' }
      }

      const { password, input } = parsedBody

      if (input && !password) {
        return { authorized: false, error: 'auth_required_password' }
      }

      if (!password) {
        return { authorized: false, error: 'Password is required' }
      }

      if (!resource.password) {
        logger.error(`[${requestId}] No password set for password-protected ${resource.id}`)
        return { authorized: false, error: 'Authentication configuration error' }
      }

      const ip = getClientIp(request)
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `${cookiePrefix}-password:ip:${resource.id}:${ip}`,
        PASSWORD_IP_RATE_LIMIT
      )
      if (!ipRateLimit.allowed) {
        logger.warn(
          `[${requestId}] Password attempt IP rate limit exceeded for ${resource.id} from ${ip}`
        )
        return {
          authorized: false,
          error: 'Too many attempts. Please try again later.',
          status: 429,
          retryAfterMs: ipRateLimit.retryAfterMs ?? PASSWORD_IP_RATE_LIMIT.refillIntervalMs,
        }
      }

      const { decrypted } = await decryptSecret(resource.password)
      if (!safeCompare(password, decrypted)) {
        return { authorized: false, error: 'Invalid password' }
      }

      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'email') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Email is required' }
      }

      const { email, input } = parsedBody

      if (input && !email) {
        return { authorized: false, error: 'auth_required_email' }
      }

      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }

      const allowedEmails = (resource.allowedEmails as string[]) || []

      if (isEmailAllowed(email, allowedEmails)) {
        return { authorized: false, error: 'otp_required' }
      }

      return { authorized: false, error: 'Email not authorized' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'sso') {
    try {
      if (request.method !== 'GET' && !parsedBody) {
        return { authorized: false, error: 'SSO authentication is required' }
      }

      const { getSession } = await import('@/lib/auth')
      const session = await getSession()

      if (!session || !session.user) {
        return { authorized: false, error: 'auth_required_sso' }
      }

      const userEmail = session.user.email
      if (!userEmail) {
        return { authorized: false, error: 'SSO session does not contain email' }
      }

      const allowedEmails = (resource.allowedEmails as string[]) || []

      if (isEmailAllowed(userEmail, allowedEmails)) {
        return { authorized: true }
      }

      return { authorized: false, error: 'Your email is not authorized to access this resource' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating SSO:`, error)
      return { authorized: false, error: 'SSO authentication error' }
    }
  }

  return { authorized: false, error: 'Unsupported authentication type' }
}
