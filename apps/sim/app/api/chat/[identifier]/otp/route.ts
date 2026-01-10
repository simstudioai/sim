import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { chat, verification } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gt } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { renderOTPEmail } from '@/components/emails'
import { getRedisClient } from '@/lib/core/config/redis'
import { addCorsHeaders } from '@/lib/core/security/deployment'
import { getStorageMethod } from '@/lib/core/storage'
import { generateRequestId } from '@/lib/core/utils/request'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { setChatAuthCookie } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatOtpAPI')

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

const OTP_EXPIRY = 15 * 60 // 15 minutes
const OTP_EXPIRY_MS = OTP_EXPIRY * 1000

/**
 * Stores OTP in Redis or database depending on storage method.
 * Uses the verification table for database storage.
 */
async function storeOTP(email: string, chatId: string, otp: string): Promise<void> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    const key = `otp:${email}:${chatId}`
    await redis.set(key, otp, 'EX', OTP_EXPIRY)
  } else {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS)

    await db.transaction(async (tx) => {
      await tx.delete(verification).where(eq(verification.identifier, identifier))
      await tx.insert(verification).values({
        id: randomUUID(),
        identifier,
        value: otp,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
    })
  }
}

async function getOTP(email: string, chatId: string): Promise<string | null> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    const key = `otp:${email}:${chatId}`
    return redis.get(key)
  }

  const now = new Date()
  const [record] = await db
    .select({
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
    .limit(1)

  if (!record) return null

  return record.value
}

async function deleteOTP(email: string, chatId: string): Promise<void> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    const key = `otp:${email}:${chatId}`
    await redis.del(key)
  } else {
    await db.delete(verification).where(eq(verification.identifier, identifier))
  }
}

const otpRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const otpVerifySchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing OTP request for identifier: ${identifier}`)

    const body = await request.json()
    const { email } = otpRequestSchema.parse(body)

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
      return addCorsHeaders(createErrorResponse('Email not authorized for this chat', 403), request)
    }

    const otp = generateOTP()
    await storeOTP(email, deployment.id, otp)

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
      return addCorsHeaders(createErrorResponse('Failed to send verification email', 500), request)
    }

    logger.info(`[${requestId}] OTP sent to ${email} for chat ${deployment.id}`)
    return addCorsHeaders(createSuccessResponse({ message: 'Verification code sent' }), request)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return addCorsHeaders(
        createErrorResponse(error.errors[0]?.message || 'Invalid request', 400),
        request
      )
    }
    logger.error(`[${requestId}] Error processing OTP request:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Verifying OTP for identifier: ${identifier}`)

    const body = await request.json()
    const { email, otp } = otpVerifySchema.parse(body)

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

    const storedOTP = await getOTP(email, deployment.id)
    if (!storedOTP) {
      return addCorsHeaders(
        createErrorResponse('No verification code found, request a new one', 400),
        request
      )
    }

    if (storedOTP !== otp) {
      return addCorsHeaders(createErrorResponse('Invalid verification code', 400), request)
    }

    await deleteOTP(email, deployment.id)

    const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)
    setChatAuthCookie(response, deployment.id, deployment.authType)

    return response
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return addCorsHeaders(
        createErrorResponse(error.errors[0]?.message || 'Invalid request', 400),
        request
      )
    }
    logger.error(`[${requestId}] Error verifying OTP:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request
    )
  }
}
