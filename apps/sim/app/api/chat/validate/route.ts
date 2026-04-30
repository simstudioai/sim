import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { identifierValidationQuerySchema } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatValidateAPI')

/**
 * GET endpoint to validate chat identifier availability
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const identifier = searchParams.get('identifier')

    const validation = identifierValidationQuerySchema.safeParse({ identifier })

    if (!validation.success) {
      const errorMessage = getValidationErrorMessage(validation.error, 'Invalid identifier')
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
      .where(and(eq(chat.identifier, validatedIdentifier), isNull(chat.archivedAt)))
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
})
