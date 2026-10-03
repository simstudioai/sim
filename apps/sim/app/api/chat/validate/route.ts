import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { identifierValidationQuerySchema } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { enforceUserRateLimit, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatValidateAPI')

/**
 * Caps how far one caller can walk a dictionary of identifiers. Sized for a
 * debounced availability field, which sends one request per pause in typing.
 */
const IDENTIFIER_CHECK_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 60,
  refillIntervalMs: 60_000,
}

/**
 * GET endpoint to validate chat identifier availability.
 *
 * Chat identifiers are globally unique, so availability cannot be scoped to a
 * workspace and there is no resource here to authorize. What the endpoint must
 * not be is anonymous: `available: false` names a live deployment, and the chat
 * behind it executes its owner's workflow on their budget for anyone holding
 * the identifier, so an unmetered answer is a deployment inventory.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

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

    const rateLimited = await enforceUserRateLimit(
      'chat-identifier-check',
      session.user.id,
      IDENTIFIER_CHECK_RATE_LIMIT
    )
    if (rateLimited) return rateLimited

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
