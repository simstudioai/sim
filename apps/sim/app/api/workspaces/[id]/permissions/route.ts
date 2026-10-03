import { type NextRequest, NextResponse } from 'next/server'
import {
  getWorkspacePermissionsContract,
  updateWorkspacePermissionsContract,
} from '@/lib/api/contracts/workspaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  readWorkspacePermissions,
  updateWorkspacePermissions,
  workspacePermissionOperations,
} from '@/lib/workspaces/application/manage-permissions'
import { WorkspacePermissionError } from '@/lib/workspaces/permissions/management-store'

function permissionErrorResponse(error: unknown): NextResponse {
  // Preserve the existing HTTP error envelope while the shared use case stays transport-neutral.
  if (error instanceof OrchestrationError && error.cause instanceof HttpError)
    return permissionErrorResponse(error.cause)
  if (error instanceof WorkspacePermissionError)
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  if (error instanceof InternalUnauthenticatedError)
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (
    error instanceof InsufficientWorkspacePermissionsError ||
    error instanceof NoWorkspaceAccessError
  )
    return NextResponse.json(
      {
        error: 'Admin access required to update permissions',
      },
      { status: 403 }
    )
  if (error instanceof OrchestrationError)
    return NextResponse.json(
      { error: error.message },
      { status: statusForOrchestrationError(error.code) }
    )
  throw error
}

export const GET = defineInternalJsonRoute({
  contract: getWorkspacePermissionsContract,
  auth: internalSessionAuth,
  operation: workspacePermissionOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing workspace roster read policy.',
  }),
  errorPolicy: {
    project(error) {
      if (error instanceof InternalUnauthenticatedError)
        return internalErrorResponse(401, { error: 'Authentication required' })
      if (
        error instanceof InsufficientWorkspacePermissionsError ||
        error instanceof NoWorkspaceAccessError ||
        (error instanceof OrchestrationError && error.code === 'not_found')
      )
        return internalErrorResponse(404, { error: 'Workspace not found or access denied' })
      return null
    },
  },
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: readWorkspacePermissions,
})

/** The existing access-before-body lifecycle uses the canonical use case's authorization phase. */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const principal = await internalSessionAuth.authenticate()
      const { id: workspaceId } = await context.params
      await updateWorkspacePermissions.authorize({ principal, input: { workspaceId, updates: [] } })
      const parsed = await parseRequest(updateWorkspacePermissionsContract, request, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const result = await updateWorkspacePermissions.execute({
        principal,
        input: { workspaceId, updates: parsed.data.body.updates },
        request,
      })
      for (const change of result.changes) {
        captureServerEvent(
          principal.userId,
          'workspace_member_role_changed',
          { workspace_id: workspaceId, new_role: change.newRole },
          { groups: { workspace: workspaceId } }
        )
      }
      return NextResponse.json({ message: result.message })
    } catch (error) {
      return permissionErrorResponse(error)
    }
  }
)
