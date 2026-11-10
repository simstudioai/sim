import { getPostgresErrorCode } from '@sim/utils/errors'
import { createWorkspaceContract, listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createViewerWorkspace,
  listViewerWorkspaces,
} from '@/lib/workspaces/application/viewer-workspaces'
import { WorkspaceOwnerMissingError } from '@/lib/workspaces/policy'

const viewerWorkspaceErrorPolicy: InternalErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    /** A cached session cookie outlived the account it belongs to. */
    if (error instanceof WorkspaceOwnerMissingError)
      return internalErrorResponse(401, { error: 'Unauthorized' })
    if (error instanceof OrganizationMembershipNotFoundError)
      return internalErrorResponse(403, { error: 'Forbidden - Not a member of this organization' })
    return null
  }
)

export const GET = defineInternalJsonRoute({
  contract: listWorkspacesContract,
  auth: internalSessionAuth,
  operation: listViewerWorkspaces.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve workspace listing behavior' }),
  errorPolicy: viewerWorkspaceErrorPolicy,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid query parameters'),
  },
  mapInput: ({ query }) => query,
  useCase: listViewerWorkspaces,
})

export const POST = defineInternalJsonRoute({
  contract: createWorkspaceContract,
  auth: internalSessionAuth,
  operation: createViewerWorkspace.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve workspace creation behavior' }),
  errorPolicy: {
    ...extendInternalErrorPolicy(viewerWorkspaceErrorPolicy, (error) => {
      /**
       * The preflight refusal and the revocation-race refusal are the same decision reached at
       * two moments, so both carry `details.code: PERMISSION_GROUP_CAPABILITY_BLOCKED`.
       */
      if (error instanceof PermissionGroupCapabilityError)
        return internalErrorResponse(403, {
          error: error.message,
          details: { code: error.detailCode },
        })
      /**
       * A lock timeout is contention, not a fault: creation serializes on the organization's
       * mutation locks and on `permission_group:<org>`, so a concurrent create or a
       * permission-group admin write can exhaust the `lock_timeout`. The caller should retry.
       */
      if (getPostgresErrorCode(error) === '55P03')
        return internalErrorResponse(503, {
          error: 'This organization is being updated by another request. Please try again.',
        })
      return null
    }),
    unhandled: () => internalErrorResponse(500, { error: 'Failed to create workspace' }),
  },
  mapInput: ({ body }) => body,
  useCase: createViewerWorkspace,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'workspace_created',
      {
        workspace_id: result.id,
        name: result.name,
        workspace_mode: result.workspaceMode,
        organization_id: result.organizationId,
      },
      {
        groups: { workspace: result.id },
        setOnce: { first_workspace_created_at: new Date().toISOString() },
      }
    )
  },
  present: (workspace) => ({
    workspace: {
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    },
  }),
})
