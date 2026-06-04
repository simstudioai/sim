import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { formIdentifierValidationQuerySchema } from '@/lib/api/contracts/forms'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormValidateAPI')

/**
 * GET endpoint to validate form identifier availability
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }
    const { searchParams } = new URL(request.url)
    const identifier = searchParams.get('identifier')

    const validation = formIdentifierValidationQuerySchema.safeParse({ identifier })

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

    const existingForm = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.identifier, validatedIdentifier), isNull(form.archivedAt)))
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
    const message = getErrorMessage(error, 'Failed to validate identifier')
    logger.error('Error validating form identifier:', error)
    return createErrorResponse(message, 500)
  }
})
