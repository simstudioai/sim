import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateTableImportContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTableImportResource,
  toV2CreateTableImport,
} from '@/lib/table/orchestration/import-resource'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableLockError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableImportsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'table-import')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate
    const parsed = await parseRequest(
      v2CreateTableImportContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const scopeError = await resolveWorkspaceScope(rateLimit, parsed.data.body.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)
    const created = await createTableImportResource(
      parsed.data.body,
      userId,
      request.nextUrl.origin
    )
    return v2Data(toV2CreateTableImport(created), { rateLimit, status: 201 })
  } catch (error) {
    const lockError = v2TableLockError(error)
    if (lockError) return lockError
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified
    logger.error('Failed to create table import', { error: getErrorMessage(error) })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
