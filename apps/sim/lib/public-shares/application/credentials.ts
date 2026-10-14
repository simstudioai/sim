import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { normalizeEmail } from '@sim/utils/string'
import { getOtpSubject, renderOTPEmail } from '@/components/emails'
import { RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { createDeploymentAuthCookie, isEmailAllowed } from '@/lib/core/security/deployment'
import {
  decodeOTPValue,
  deleteOTP,
  generateOTP,
  getOTP,
  incrementOTPAttempts,
  MAX_OTP_ATTEMPTS,
  OTP_EMAIL_RATE_LIMIT,
  OTP_RESOURCE_RATE_LIMIT,
  storeOTP,
} from '@/lib/core/security/otp'
import { sendEmail } from '@/lib/messaging/email/mailer'
import {
  authorizePublicFileShare,
  preparePublicFileShareChallenge,
} from '@/lib/public-shares/application/authorization'

const logger = createLogger('PublicFileShareCredentials')
const rateLimiter = new RateLimiter()
const SSO_RESOURCE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 100,
  refillRate: 100,
  refillIntervalMs: 15 * 60_000,
}
const OTP_LOCKED_MESSAGE = 'Too many failed attempts. Please request a new code.'

/** Exchanges a verified password for a cookie bound to the share's current password slot. */
export async function authenticatePublicFileSharePassword({
  token,
  password,
  clientIp,
}: {
  token: string
  password: string
  clientIp?: string | null
}) {
  const challenge = await preparePublicFileShareChallenge(token, 'password')
  const result = await authorizePublicFileShare({
    token,
    credential: { method: 'POST', password, clientIp },
  })
  if (!result.authorized) return result
  const resource = await challenge.withCurrentPolicy(({ share }) => share)
  const cookie = await createDeploymentAuthCookie({ cookiePrefix: 'file', resource })
  await challenge.withCurrentPolicy(() => undefined)
  return { authorized: true as const, authType: 'password' as const, cookie }
}

/** Schedules code delivery without revealing whether the supplied email is on the allow-list. */
export async function requestPublicFileShareOtp({
  token,
  email,
}: {
  token: string
  email: string
}) {
  const normalizedEmail = normalizeEmail(email)
  const challenge = await preparePublicFileShareChallenge(token, 'email')
  return {
    async deliver(): Promise<void> {
      const allowed = await challenge.withCurrentPolicy(({ share }) =>
        isEmailAllowed(normalizedEmail, share.allowedEmails)
      )
      if (!allowed) return
      const resourceLimit = await rateLimiter.checkRateLimitDirect(
        `file-otp:resource:${challenge.shareId}`,
        OTP_RESOURCE_RATE_LIMIT,
        { failClosed: true }
      )
      if (!resourceLimit.allowed) return
      const emailLimit = await rateLimiter.checkRateLimitDirect(
        `file-otp:email:${challenge.shareId}:${normalizedEmail}`,
        OTP_EMAIL_RATE_LIMIT,
        { failClosed: true }
      )
      if (!emailLimit.allowed) return
      const otp = generateOTP()
      await storeOTP('file', challenge.shareId, normalizedEmail, otp)
      const html = await renderOTPEmail(otp, 'email-verification', 'a shared file')
      await challenge.withCurrentPolicy(() => undefined)
      const result = await sendEmail({
        to: normalizedEmail,
        subject: getOtpSubject('a shared file'),
        html,
      })
      if (!result.success)
        logger.error('Failed to send public file verification code', {
          shareId: challenge.shareId,
          message: result.message,
        })
    },
  }
}

/** Consumes the existing email code and issues a cookie only while its original sharing policy remains current. */
export async function verifyPublicFileShareOtp({
  token,
  email,
  otp,
}: {
  token: string
  email: string
  otp: string
}) {
  const normalizedEmail = normalizeEmail(email)
  const challenge = await preparePublicFileShareChallenge(token, 'email')
  const allowed = await challenge.withCurrentPolicy(({ share }) =>
    isEmailAllowed(normalizedEmail, share.allowedEmails)
  )
  if (!allowed) return { authorized: false as const, error: 'Email not authorized', status: 403 }
  const value = await getOTP('file', challenge.shareId, normalizedEmail)
  await challenge.withCurrentPolicy(() => undefined)
  if (!value)
    return {
      authorized: false as const,
      error: 'No verification code found, request a new one',
      status: 400,
    }
  const stored = decodeOTPValue(value)
  if (stored.attempts >= MAX_OTP_ATTEMPTS) {
    await deleteOTP('file', challenge.shareId, normalizedEmail)
    return { authorized: false as const, error: OTP_LOCKED_MESSAGE, status: 429 }
  }
  if (!safeCompare(stored.otp, otp)) {
    const result = await incrementOTPAttempts('file', challenge.shareId, normalizedEmail, value)
    return {
      authorized: false as const,
      error: result === 'locked' ? OTP_LOCKED_MESSAGE : 'Invalid verification code',
      status: result === 'locked' ? 429 : 400,
    }
  }
  await deleteOTP('file', challenge.shareId, normalizedEmail)
  const resource = await challenge.withCurrentPolicy(({ share }) => share)
  const cookie = await createDeploymentAuthCookie({
    cookiePrefix: 'file',
    resource,
    verifiedEmail: normalizedEmail,
  })
  await challenge.withCurrentPolicy(() => undefined)
  return { authorized: true as const, authType: 'email' as const, cookie }
}

/** Checks allow-list eligibility for the SSO redirect without granting access or asserting session identity. */
export async function getPublicFileShareSsoEligibility({
  token,
  email,
}: {
  token: string
  email: string
}) {
  const challenge = await preparePublicFileShareChallenge(token, 'sso')
  const limit = await rateLimiter.checkRateLimitDirect(
    `file-sso:resource:${challenge.shareId}`,
    SSO_RESOURCE_RATE_LIMIT,
    { failClosed: true }
  )
  if (!limit.allowed)
    return {
      allowed: false as const,
      error: 'Too many requests. Please try again later.',
      status: 429,
      retryAfterMs: limit.retryAfterMs ?? SSO_RESOURCE_RATE_LIMIT.refillIntervalMs,
    }
  const eligible = await challenge.withCurrentPolicy(({ share }) =>
    isEmailAllowed(normalizeEmail(email), share.allowedEmails)
  )
  return { allowed: true as const, eligible }
}
