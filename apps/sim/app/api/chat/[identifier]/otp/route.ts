import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { renderOTPEmail } from '@/components/emails'
import { requestChatEmailOtpContract, verifyChatEmailOtpContract } from '@/lib/api/contracts/chats'
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
import { setChatAuthCookie } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatOtpAPI')

const rateLimiter = new RateLimiter()

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params
    const requestId = generateRequestId()

    try {
      const ip = getClientIp(request)
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `chat-otp:ip:${identifier}:${ip}`,
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

      const parsed = await parseRequest(requestChatEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const { email } = parsed.data.body

      const deploymentResult = await db
        .select({
          id: chat.id,
          authType: chat.authType,
          allowedEmails: chat.allowedEmails,
          title: chat.title,
        })
        .from(chat)
        .where(
          and(eq(chat.identifier, identifier), eq(chat.isActive, true), isNull(chat.archivedAt))
        )
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return createErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      if (deployment.authType !== 'email') {
        return createErrorResponse('This chat does not use email authentication', 400)
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? deployment.allowedEmails
        : []

      if (!isEmailAllowed(email, allowedEmails)) {
        return createErrorResponse('Email not authorized for this chat', 403)
      }

      const emailRateLimit = await rateLimiter.checkRateLimitDirect(
        `chat-otp:email:${deployment.id}:${email.toLowerCase()}`,
        OTP_EMAIL_RATE_LIMIT
      )
      if (!emailRateLimit.allowed) {
        logger.warn(
          `[${requestId}] OTP email rate limit exceeded for ${email} on chat ${deployment.id}`
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
      await storeOTP('chat', deployment.id, email, otp)

      const emailHtml = await renderOTPEmail(
        otp,
        email,
        'email-verification',
        deployment.title || 'Chat'
      )

      const emailResult = await sendEmail({
        to: email,
        subject: `Verification code for ${deployment.title || 'Chat'}`,
        html: emailHtml,
      })

      if (!emailResult.success) {
        logger.error(`[${requestId}] Failed to send OTP email:`, emailResult.message)
        return createErrorResponse('Failed to send verification email', 500)
      }

      logger.info(`[${requestId}] OTP sent to ${email} for chat ${deployment.id}`)
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
      const parsed = await parseRequest(verifyChatEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const { email, otp } = parsed.data.body

      const deploymentResult = await db
        .select({
          id: chat.id,
          title: chat.title,
          description: chat.description,
          customizations: chat.customizations,
          authType: chat.authType,
          password: chat.password,
          outputConfigs: chat.outputConfigs,
        })
        .from(chat)
        .where(
          and(eq(chat.identifier, identifier), eq(chat.isActive, true), isNull(chat.archivedAt))
        )
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return createErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      const storedValue = await getOTP('chat', deployment.id, email)
      if (!storedValue) {
        return createErrorResponse('No verification code found, request a new one', 400)
      }

      const { otp: storedOTP, attempts } = decodeOTPValue(storedValue)

      if (attempts >= MAX_OTP_ATTEMPTS) {
        await deleteOTP('chat', deployment.id, email)
        logger.warn(`[${requestId}] OTP already locked out for ${email}`)
        return createErrorResponse('Too many failed attempts. Please request a new code.', 429)
      }

      if (storedOTP !== otp) {
        const result = await incrementOTPAttempts('chat', deployment.id, email, storedValue)
        if (result === 'locked') {
          logger.warn(`[${requestId}] OTP invalidated after max failed attempts for ${email}`)
          return createErrorResponse('Too many failed attempts. Please request a new code.', 429)
        }
        return createErrorResponse('Invalid verification code', 400)
      }

      await deleteOTP('chat', deployment.id, email)

      const response = createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
        outputConfigs: deployment.outputConfigs,
      })
      setChatAuthCookie(response, deployment.id, deployment.authType, deployment.password)

      return response
    } catch (error) {
      logger.error(`[${requestId}] Error verifying OTP:`, error)
      return createErrorResponse('Failed to process request', 500)
    }
  }
)
