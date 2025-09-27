import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatValidateAPI')

/**
 * GET endpoint to validate chat identifier availability
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const identifier = searchParams.get('identifier')

    if (!identifier) {
      return createErrorResponse('Identifier parameter is required', 400)
    }

    if (!/^[a-z0-9-]+$/.test(identifier)) {
      return createSuccessResponse({
        available: false,
        error: 'Identifier can only contain lowercase letters, numbers, and hyphens',
      })
    }

    const existingChat = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    const isAvailable = existingChat.length === 0

    logger.debug(
      `Identifier "${identifier}" availability check: ${isAvailable ? 'available' : 'taken'}`
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
