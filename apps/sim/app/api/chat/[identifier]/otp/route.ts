import { randomInt, randomUUID } from 'crypto'
import { db } from '@sim/db'
import { chat, verification } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { renderOTPEmail } from '@/components/emails'
import { getRedisClient } from '@/lib/core/config/redis'
import { addCorsHeaders, isEmailAllowed } from '@/lib/core/security/deployment'
import { getStorageMethod } from '@/lib/core/storage'
import { generateRequestId } from '@/lib/core/utils/request'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { setChatAuthCookie } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatOtpAPI')

function generateOTP(): string {
  return randomInt(100000, 1000000).toString()
}

const OTP_EXPIRY = 15 * 60 // 15 minutes
const OTP_EXPIRY_MS = OTP_EXPIRY * 1000
const MAX_OTP_ATTEMPTS = 5

/**
 * OTP values are stored as "code:attempts" (e.g. "654321:0").
 * This keeps the attempt counter in the same key/row as the OTP itself.
 */
function encodeOTPValue(otp: string, attempts: number): string {
  return `${otp}:${attempts}`
}

function decodeOTPValue(value: string): { otp: string; attempts: number } {
  const lastColon = value.lastIndexOf(':')
  if (lastColon === -1) return { otp: value, attempts: 0 }
  const attempts = Number.parseInt(value.slice(lastColon + 1), 10)
  return { otp: value.slice(0, lastColon), attempts: Number.isNaN(attempts) ? 0 : attempts }
}

/**
 * Stores OTP in Redis or database depending on storage method.
 * Uses the verification table for database storage.
 */
async function storeOTP(email: string, chatId: string, otp: string): Promise<void> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()
  const value = encodeOTPValue(otp, 0)

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    await redis.set(`otp:${email}:${chatId}`, value, 'EX', OTP_EXPIRY)
  } else {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS)

    await db.transaction(async (tx) => {
      await tx.delete(verification).where(eq(verification.identifier, identifier))
      await tx.insert(verification).values({
        id: randomUUID(),
        identifier,
        value,
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
    return redis.get(`otp:${email}:${chatId}`)
  }

  const now = new Date()
  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
    .limit(1)

  return record?.value ?? null
}

/**
 * Lua script for atomic OTP attempt increment.
 * Returns: "LOCKED" if max attempts reached (key deleted), new encoded value otherwise, nil if key missing.
 */
const ATOMIC_INCREMENT_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if not val then return nil end
local colon = val:find(':([^:]*$)')
local otp, attempts
if colon then
  otp = val:sub(1, colon - 1)
  attempts = tonumber(val:sub(colon + 1)) or 0
else
  otp = val
  attempts = 0
end
attempts = attempts + 1
if attempts >= tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  return 'LOCKED'
end
local newVal = otp .. ':' .. attempts
redis.call('SET', KEYS[1], newVal, 'KEEPTTL')
return newVal
`

/**
 * Atomically increments OTP attempts. Returns 'locked' if max reached, 'incremented' otherwise.
 */
async function incrementOTPAttempts(
  email: string,
  chatId: string,
  currentValue: string
): Promise<'locked' | 'incremented'> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    const key = `otp:${email}:${chatId}`
    const result = await redis.eval(ATOMIC_INCREMENT_SCRIPT, 1, key, MAX_OTP_ATTEMPTS)
    return result === 'LOCKED' ? 'locked' : 'incremented'
  }

  // DB path: optimistic locking — only update if value hasn't changed since we read it
  const { otp, attempts } = decodeOTPValue(currentValue)
  const newAttempts = attempts + 1

  if (newAttempts >= MAX_OTP_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.identifier, identifier))
    return 'locked'
  }

  const newValue = encodeOTPValue(otp, newAttempts)
  const updated = await db
    .update(verification)
    .set({ value: newValue, updatedAt: new Date() })
    .where(and(eq(verification.identifier, identifier), eq(verification.value, currentValue)))
    .returning({ id: verification.id })

  // If no rows updated, another request already incremented — re-read to check state
  if (updated.length === 0) {
    const fresh = await getOTP(email, chatId)
    if (!fresh) return 'locked'
    const { attempts: freshAttempts } = decodeOTPValue(fresh)
    return freshAttempts >= MAX_OTP_ATTEMPTS ? 'locked' : 'incremented'
  }

  return 'incremented'
}

async function deleteOTP(email: string, chatId: string): Promise<void> {
  const identifier = `chat-otp:${chatId}:${email}`
  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    await redis.del(`otp:${email}:${chatId}`)
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
      .where(and(eq(chat.identifier, identifier), eq(chat.isActive, true), isNull(chat.archivedAt)))
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

    if (!isEmailAllowed(email, allowedEmails)) {
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
    const body = await request.json()
    const { email, otp } = otpVerifySchema.parse(body)

    const deploymentResult = await db
      .select({
        id: chat.id,
        authType: chat.authType,
      })
      .from(chat)
      .where(and(eq(chat.identifier, identifier), eq(chat.isActive, true), isNull(chat.archivedAt)))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    const storedValue = await getOTP(email, deployment.id)
    if (!storedValue) {
      return addCorsHeaders(
        createErrorResponse('No verification code found, request a new one', 400),
        request
      )
    }

    const { otp: storedOTP, attempts } = decodeOTPValue(storedValue)

    if (attempts >= MAX_OTP_ATTEMPTS) {
      await deleteOTP(email, deployment.id)
      logger.warn(`[${requestId}] OTP already locked out for ${email}`)
      return addCorsHeaders(
        createErrorResponse('Too many failed attempts. Please request a new code.', 429),
        request
      )
    }

    if (storedOTP !== otp) {
      const result = await incrementOTPAttempts(email, deployment.id, storedValue)
      if (result === 'locked') {
        logger.warn(`[${requestId}] OTP invalidated after max failed attempts for ${email}`)
        return addCorsHeaders(
          createErrorResponse('Too many failed attempts. Please request a new code.', 429),
          request
        )
      }
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
