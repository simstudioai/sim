import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { renderOTPEmail } from '@/components/emails'
import { requestFormEmailOtpContract, verifyFormEmailOtpContract } from '@/lib/api/contracts/forms'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isEmailAllowed } from '@/lib/core/security/deployment'
import {
  decodeOTPValue,
  deleteOTP,
  generateOTP,
  getOTP,
  incrementOTPAttempts,
  MAX_OTP_ATTEMPTS,
  OTP_EMAIL_RATE_LIMIT,
  OTP_IP_RATE_LIMIT,
  storeOTP,
} from '@/lib/core/security/otp'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { setFormAuthCookie } from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormOtpAPI')

const rateLimiter = new RateLimiter()

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params
    const requestId = generateRequestId()

    try {
      const ip = getClientIp(request)
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `form-otp:ip:${identifier}:${ip}`,
        OTP_IP_RATE_LIMIT
      )
      if (!ipRateLimit.allowed) {
        logger.warn(`[${requestId}] OTP IP rate limit exceeded for ${identifier} from ${ip}`)
        const retryAfter = Math.ceil(
          (ipRateLimit.retryAfterMs ?? OTP_IP_RATE_LIMIT.refillIntervalMs) / 1000
        )
        const response = createErrorResponse('Too many requests. Please try again later.', 429)
        response.headers.set('Retry-After', String(retryAfter))
        return response
      }

      const parsed = await parseRequest(requestFormEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const { email } = parsed.data.body

      const deploymentResult = await db
        .select({
          id: form.id,
          authType: form.authType,
          allowedEmails: form.allowedEmails,
          title: form.title,
          isActive: form.isActive,
        })
        .from(form)
        .where(and(eq(form.identifier, identifier), isNull(form.archivedAt)))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
        return createErrorResponse('Form not found', 404)
      }

      const deployment = deploymentResult[0]

      if (!deployment.isActive) {
        return createErrorResponse('This form is currently unavailable', 403)
      }

      if (deployment.authType !== 'email') {
        return createErrorResponse('This form does not use email authentication', 400)
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? (deployment.allowedEmails as string[])
        : []

      if (!isEmailAllowed(email, allowedEmails)) {
        return createErrorResponse('Email not authorized for this form', 403)
      }

      const emailRateLimit = await rateLimiter.checkRateLimitDirect(
        `form-otp:email:${deployment.id}:${email.toLowerCase()}`,
        OTP_EMAIL_RATE_LIMIT
      )
      if (!emailRateLimit.allowed) {
        logger.warn(
          `[${requestId}] OTP email rate limit exceeded for ${email} on form ${deployment.id}`
        )
        const retryAfter = Math.ceil(
          (emailRateLimit.retryAfterMs ?? OTP_EMAIL_RATE_LIMIT.refillIntervalMs) / 1000
        )
        const response = createErrorResponse(
          'Too many verification code requests. Please try again later.',
          429
        )
        response.headers.set('Retry-After', String(retryAfter))
        return response
      }

      const otp = generateOTP()
      await storeOTP('form', deployment.id, email, otp)

      const emailHtml = await renderOTPEmail(
        otp,
        email,
        'email-verification',
        deployment.title || 'Form'
      )

      const emailResult = await sendEmail({
        to: email,
        subject: `Verification code for ${deployment.title || 'Form'}`,
        html: emailHtml,
      })

      if (!emailResult.success) {
        logger.error(`[${requestId}] Failed to send OTP email:`, emailResult.message)
        return createErrorResponse('Failed to send verification email', 500)
      }

      logger.info(`[${requestId}] OTP sent to ${email} for form ${deployment.id}`)
      return createSuccessResponse({ message: 'Verification code sent' })
    } catch (error) {
      logger.error(`[${requestId}] Error processing OTP request:`, error)
      return createErrorResponse('Failed to process request', 500)
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params
    const requestId = generateRequestId()

    try {
      const parsed = await parseRequest(verifyFormEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const { email, otp } = parsed.data.body

      const deploymentResult = await db
        .select({
          id: form.id,
          authType: form.authType,
          password: form.password,
          allowedEmails: form.allowedEmails,
          isActive: form.isActive,
        })
        .from(form)
        .where(and(eq(form.identifier, identifier), isNull(form.archivedAt)))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
        return createErrorResponse('Form not found', 404)
      }

      const deployment = deploymentResult[0]

      if (!deployment.isActive) {
        return createErrorResponse('This form is currently unavailable', 403)
      }

      if (deployment.authType !== 'email') {
        return createErrorResponse('This form does not use email authentication', 400)
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? (deployment.allowedEmails as string[])
        : []

      if (!isEmailAllowed(email, allowedEmails)) {
        return createErrorResponse('Email not authorized for this form', 403)
      }

      const storedValue = await getOTP('form', deployment.id, email)
      if (!storedValue) {
        return createErrorResponse('No verification code found, request a new one', 400)
      }

      const { otp: storedOTP, attempts } = decodeOTPValue(storedValue)

      if (attempts >= MAX_OTP_ATTEMPTS) {
        await deleteOTP('form', deployment.id, email)
        logger.warn(`[${requestId}] OTP already locked out for ${email}`)
        return createErrorResponse('Too many failed attempts. Please request a new code.', 429)
      }

      if (storedOTP !== otp) {
        const result = await incrementOTPAttempts('form', deployment.id, email, storedValue)
        if (result === 'locked') {
          logger.warn(`[${requestId}] OTP invalidated after max failed attempts for ${email}`)
          return createErrorResponse('Too many failed attempts. Please request a new code.', 429)
        }
        return createErrorResponse('Invalid verification code', 400)
      }

      await deleteOTP('form', deployment.id, email)

      const response = createSuccessResponse({ authenticated: true })
      setFormAuthCookie(response, deployment.id, deployment.authType, deployment.password)

      return response
    } catch (error) {
      logger.error(`[${requestId}] Error verifying OTP:`, error)
      return createErrorResponse('Failed to process request', 500)
    }
  }
)
