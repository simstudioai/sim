import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { renderOTPEmail } from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'
import { generateRequestId } from '@/lib/utils'
import { addCorsHeaders, setChatAuthCookie } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatOtpAPI')

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// OTP storage utility functions using Redis
// We use 15 minutes (900 seconds) expiry for OTPs
const OTP_EXPIRY = 15 * 60

async function storeOTP(email: string, chatId: string, otp: string): Promise<boolean> {
  const key = `otp:${email}:${chatId}`
  const redis = getRedisClient()

  if (!redis) {
    logger.warn('Redis not available, OTP functionality requires Redis')
    return false
  }

  try {
    await redis.set(key, otp, 'EX', OTP_EXPIRY)
    return true
  } catch (error) {
    logger.error('Error storing OTP in Redis:', error)
    return false
  }
}

async function getOTP(email: string, chatId: string): Promise<string | null> {
  const key = `otp:${email}:${chatId}`
  const redis = getRedisClient()

  if (!redis) {
    return null
  }

  try {
    return await redis.get(key)
  } catch (error) {
    logger.error('Error getting OTP from Redis:', error)
    return null
  }
}

async function deleteOTP(email: string, chatId: string): Promise<void> {
  const key = `otp:${email}:${chatId}`
  const redis = getRedisClient()

  if (!redis) {
    return
  }

  try {
    await redis.del(key)
  } catch (error) {
    logger.error('Error deleting OTP from Redis:', error)
  }
}

const otpRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const otpVerifySchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

// Send OTP endpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing OTP request for identifier: ${identifier}`)

    // Parse request body
    let body
    try {
      body = await request.json()
      const { email } = otpRequestSchema.parse(body)

      // Find the chat deployment
      const deploymentResult = await db
        .select({
          id: chat.id,
          authType: chat.authType,
          allowedEmails: chat.allowedEmails,
          title: chat.title,
        })
        .from(chat)
        .where(eq(chat.identifier, identifier))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
      }

      const deployment = deploymentResult[0]

      // Verify this is an email-protected chat
      if (deployment.authType !== 'email') {
        return addCorsHeaders(
          createErrorResponse('This chat does not use email authentication', 400),
          request
        )
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? deployment.allowedEmails
        : []

      const isEmailAllowed =
        allowedEmails.includes(email) ||
        allowedEmails.some((allowed: string) => {
          if (allowed.startsWith('@')) {
            const domain = email.split('@')[1]
            return domain && allowed === `@${domain}`
          }
          return false
        })

      if (!isEmailAllowed) {
        return addCorsHeaders(
          createErrorResponse('Email not authorized for this chat', 403),
          request
        )
      }

      const otp = generateOTP()

      const stored = await storeOTP(email, deployment.id, otp)
      if (!stored) {
        logger.error(`[${requestId}] Failed to store OTP - Redis unavailable`)
        return addCorsHeaders(
          createErrorResponse(
            'Email verification temporarily unavailable, please try again later',
            503
          ),
          request
        )
      }

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
        return addCorsHeaders(
          createErrorResponse('Failed to send verification email', 500),
          request
        )
      }

      // Add a small delay to ensure Redis has fully processed the operation
      // This helps with eventual consistency in distributed systems
      await new Promise((resolve) => setTimeout(resolve, 500))

      logger.info(`[${requestId}] OTP sent to ${email} for chat ${deployment.id}`)
      return addCorsHeaders(createSuccessResponse({ message: 'Verification code sent' }), request)
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return addCorsHeaders(
          createErrorResponse(error.errors[0]?.message || 'Invalid request', 400),
          request
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing OTP request:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request
    )
  }
}

// Verify OTP endpoint
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Verifying OTP for identifier: ${identifier}`)

    // Parse request body
    let body
    try {
      body = await request.json()
      const { email, otp } = otpVerifySchema.parse(body)

      // Find the chat deployment
      const deploymentResult = await db
        .select({
          id: chat.id,
          authType: chat.authType,
        })
        .from(chat)
        .where(eq(chat.identifier, identifier))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
      }

      const deployment = deploymentResult[0]

      // Check if OTP exists and is valid
      const storedOTP = await getOTP(email, deployment.id)
      if (!storedOTP) {
        return addCorsHeaders(
          createErrorResponse('No verification code found, request a new one', 400),
          request
        )
      }

      // Check if OTP matches
      if (storedOTP !== otp) {
        return addCorsHeaders(createErrorResponse('Invalid verification code', 400), request)
      }

      // OTP is valid, clean up
      await deleteOTP(email, deployment.id)

      // Create success response with auth cookie
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)

      // Set authentication cookie
      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return addCorsHeaders(
          createErrorResponse(error.errors[0]?.message || 'Invalid request', 400),
          request
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error verifying OTP:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request
    )
  }
}
