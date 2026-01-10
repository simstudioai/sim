import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormValidateAPI')

const validateQuerySchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .max(100, 'Identifier must be 100 characters or less'),
})

/**
 * GET endpoint to validate form identifier availability
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }
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

    const existingForm = await db
      .select({ id: form.id })
      .from(form)
      .where(eq(form.identifier, validatedIdentifier))
      .limit(1)

    const isAvailable = existingForm.length === 0

    logger.debug(
      `Identifier "${validatedIdentifier}" availability check: ${isAvailable ? 'available' : 'taken'}`
    )

    return createSuccessResponse({
      available: isAvailable,
      error: isAvailable ? null : 'This identifier is already in use',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to validate identifier'
    logger.error('Error validating form identifier:', error)
    return createErrorResponse(message, 500)
  }
}
