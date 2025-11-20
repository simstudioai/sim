import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatValidateAPI')

const validateQuerySchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .max(100, 'Identifier must be 100 characters or less'),
})

/**
 * GET endpoint to validate chat identifier availability
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const identifier = searchParams.get('identifier')

    const validation = validateQuerySchema.safeParse({ identifier })

    if (!validation.success) {
      const errorMessage = validation.error.errors[0]?.message || 'Invalid identifier'
      logger.warn(`Validation error: ${errorMessage}`)

      if (identifier && !/^[a-z0-9-]+$/.test(identifier)) {
        return createSuccessResponse({
          available: false,
          error: errorMessage,
        })
      }

      return createErrorResponse(errorMessage, 400)
    }

    const { identifier: validatedIdentifier } = validation.data

    const existingChat = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.identifier, validatedIdentifier))
      .limit(1)

    const isAvailable = existingChat.length === 0

    logger.debug(
      `Identifier "${validatedIdentifier}" availability check: ${isAvailable ? 'available' : 'taken'}`
    )

    return createSuccessResponse({
      available: isAvailable,
      error: isAvailable ? null : 'This identifier is already in use',
    })
  } catch (error: any) {
    logger.error('Error validating chat identifier:', error)
    return createErrorResponse(error.message || 'Failed to validate identifier', 500)
  }
}
