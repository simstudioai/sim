import { type NextRequest, NextResponse } from 'next/server'
import { getInboxConfigContract, updateInboxConfigContract } from '@/lib/api/contracts/inbox'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import { ForbiddenOperationError } from '@/lib/core/application'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  inboxSettingsOperations,
  readInboxSettings,
  updateInboxSettings,
} from '@/lib/workspaces/application/inbox-settings'

function inboxError(error: unknown, read: boolean) {
  if (error instanceof InternalUnauthenticatedError)
    return internalErrorResponse(401, { error: 'Unauthorized' })
  if (
    error instanceof InsufficientWorkspacePermissionsError ||
    error instanceof NoWorkspaceAccessError
  )
    return internalErrorResponse(read ? 404 : 403, {
      error: read ? 'Not found' : 'Admin access required',
    })
  if (error instanceof ForbiddenOperationError)
    return internalErrorResponse(403, { error: error.message, details: { code: error.detailCode } })
  if (error instanceof OrchestrationError)
    return internalErrorResponse(statusForOrchestrationError(error.code), { error: error.message })
  return null
}

export const GET = defineInternalJsonRoute({
  contract: getInboxConfigContract,
  auth: internalSessionAuth,
  operation: inboxSettingsOperations.read,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing inbox settings read policy.' }),
  errorPolicy: { project: (error) => inboxError(error, true) },
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: readInboxSettings,
})

/** Preserve authorization before body parsing through the shared operation's authorization phase. */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const principal = await internalSessionAuth.authenticate()
      const { id: workspaceId } = await context.params
      await updateInboxSettings.authorize({ principal, input: { workspaceId, patch: {} } })
      const parsed = await parseRequest(updateInboxConfigContract, request, context)
      if (!parsed.success) return parsed.response
      return NextResponse.json(
        await updateInboxSettings.execute({
          principal,
          input: { workspaceId, patch: parsed.data.body },
        })
      )
    } catch (error) {
      const response = inboxError(error, false)
      if (response) return NextResponse.json(response.body, { status: response.status })
      throw error
    }
  }
)
