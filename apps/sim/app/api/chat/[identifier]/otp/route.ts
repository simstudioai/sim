import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getOtpSubject, renderOTPEmail } from '@/components/emails'
import { requestChatEmailOtpContract, verifyChatEmailOtpContract } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isEmailAllowed } from '@/lib/core/security/deployment'
import {
  generateOTP,
  OTP_EMAIL_RATE_LIMIT,
  OTP_IP_RATE_LIMIT,
  OTP_RESOURCE_RATE_LIMIT,
  storeOTP,
  verifyOTP,
} from '@/lib/core/security/otp'
import { afterResponse } from '@/lib/core/utils/after-response'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { setChatAuthCookie } from '@/app/api/chat/utils'
import { createCodedErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatOtpAPI')

const rateLimiter = new RateLimiter()

function otpRequestAccepted() {
  return createSuccessResponse({ message: 'Verification code sent' })
}

async function deliverOtp(requestId: string, deploymentId: string, title: string, email: string) {
  const resourceRateLimit = await rateLimiter.checkRateLimitDirect(
    `chat-otp:resource:${deploymentId}`,
    OTP_RESOURCE_RATE_LIMIT,
    { failClosed: true }
  )
  if (!resourceRateLimit.allowed) {
    logger.warn(`OTP resource rate limit exceeded for chat ${deploymentId}`, { requestId })
    return
  }

  const emailRateLimit = await rateLimiter.checkRateLimitDirect(
    `chat-otp:email:${deploymentId}:${email.toLowerCase()}`,
    OTP_EMAIL_RATE_LIMIT,
    { failClosed: true }
  )
  if (!emailRateLimit.allowed) {
    logger.warn(`OTP email rate limit exceeded for ${email} on chat ${deploymentId}`, { requestId })
    return
  }

  const otp = generateOTP()
  await storeOTP('chat', deploymentId, email, otp)

  const emailHtml = await renderOTPEmail(otp, 'email-verification', title)
  const emailResult = await sendEmail({
    to: email,
    subject: getOtpSubject(title),
    html: emailHtml,
  })

  if (!emailResult.success) {
    logger.error('Failed to send OTP email:', emailResult.message, { requestId })
    return
  }

  logger.info(`OTP sent to ${email} for chat ${deploymentId}`, { requestId })
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params
    const requestId = generateRequestId()

    try {
      const ip = getClientIp(request)
      if (ip) {
        const ipRateLimit = await rateLimiter.checkRateLimitDirect(
          `chat-otp:ip:${identifier}:${ip}`,
          OTP_IP_RATE_LIMIT,
          { failClosed: true }
        )
        if (!ipRateLimit.allowed) {
          logger.warn(`OTP IP rate limit exceeded for ${identifier} from ${ip}`)
          const retryAfter = Math.ceil(
            (ipRateLimit.retryAfterMs ?? OTP_IP_RATE_LIMIT.refillIntervalMs) / 1000
          )
          const response = createCodedErrorResponse(
            'Too many requests. Please try again later.',
            429
          )
          response.headers.set('Retry-After', String(retryAfter))
          return response
        }
      }

      const parsed = await parseRequest(requestChatEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createCodedErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const email = normalizeEmail(parsed.data.body.email)

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
        logger.warn(`Chat not found for identifier: ${identifier}`)
        return createCodedErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      if (deployment.authType !== 'email') {
        return createCodedErrorResponse('This chat does not use email authentication', 400)
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? deployment.allowedEmails
        : []
      const emailAllowed = isEmailAllowed(email, allowedEmails)

      afterResponse(async () => {
        if (!emailAllowed) return
        await deliverOtp(requestId, deployment.id, deployment.title || 'Chat', email)
      })
      return otpRequestAccepted()
    } catch (error) {
      logger.error('Error processing OTP request:', error)
      return createCodedErrorResponse('Failed to process request', 500)
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params

    try {
      const parsed = await parseRequest(verifyChatEmailOtpContract, request, context, {
        validationErrorResponse: (error) =>
          createCodedErrorResponse(getValidationErrorMessage(error, 'Invalid request'), 400),
      })
      if (!parsed.success) return parsed.response
      const { otp } = parsed.data.body
      const email = normalizeEmail(parsed.data.body.email)

      const deploymentResult = await db
        .select({
          id: chat.id,
          title: chat.title,
          description: chat.description,
          customizations: chat.customizations,
          authType: chat.authType,
          password: chat.password,
          allowedEmails: chat.allowedEmails,
          outputConfigs: chat.outputConfigs,
          includeThinking: chat.includeThinking,
          includeToolCalls: chat.includeToolCalls,
        })
        .from(chat)
        .where(
          and(eq(chat.identifier, identifier), eq(chat.isActive, true), isNull(chat.archivedAt))
        )
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`Chat not found for identifier: ${identifier}`)
        return createCodedErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      if (deployment.authType !== 'email') {
        return createCodedErrorResponse('This chat does not use email authentication', 400)
      }
      if (!isEmailAllowed(email, deployment.allowedEmails)) {
        return createCodedErrorResponse('Email not authorized', 403)
      }

      const verification = await verifyOTP('chat', deployment.id, email, otp)
      if (verification === 'missing') {
        return createCodedErrorResponse('No verification code found, request a new one', 400)
      }
      if (verification === 'locked') {
        logger.warn('OTP invalidated after max failed attempts', { chatId: deployment.id })
        return createCodedErrorResponse('Too many failed attempts. Please request a new code.', 429)
      }
      if (verification === 'invalid') {
        return createCodedErrorResponse('Invalid verification code', 400)
      }

      const response = createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
        outputConfigs: deployment.outputConfigs,
        includeThinking: deployment.includeThinking,
        includeToolCalls: deployment.includeToolCalls,
      })
      await setChatAuthCookie(response, deployment, email)

      return response
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      return createCodedErrorResponse('Failed to process request', 500)
    }
  }
)
