import { db } from '@sim/db'
import { workflowInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { validateInterfaceIdentifierContract } from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { INTERFACE_IDENTIFIER_PATTERN, isReservedInterfaceIdentifier } from '@/lib/interfaces'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceValidateAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(validateInterfaceIdentifierContract, request, {})
    if (!parsed.success) return parsed.response

    const { identifier } = parsed.data.query

    if (!INTERFACE_IDENTIFIER_PATTERN.test(identifier)) {
      return createSuccessResponse({
        available: false,
        error: 'Identifier can only contain lowercase letters, numbers, and hyphens',
      })
    }

    if (isReservedInterfaceIdentifier(identifier)) {
      return createSuccessResponse({
        available: false,
        error: 'This identifier is reserved',
      })
    }

    const [existing] = await db
      .select({ id: workflowInterface.id })
      .from(workflowInterface)
      .where(
        and(eq(workflowInterface.identifier, identifier), isNull(workflowInterface.archivedAt))
      )
      .limit(1)

    return createSuccessResponse({
      available: !existing,
      error: existing ? 'Identifier is already in use' : null,
    })
  } catch (error) {
    logger.error('Error validating interface identifier:', error)
    return createErrorResponse('Failed to validate identifier', 500)
  }
})
