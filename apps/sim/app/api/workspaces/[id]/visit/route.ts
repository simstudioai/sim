import { recordWorkspaceVisitContract } from '@/lib/api/contracts/workspaces'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalWorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import {
  recordWorkspaceVisit,
  workspaceVisitOperations,
} from '@/lib/workspaces/application/record-workspace-visit'
import { WorkspaceOwnerMissingError } from '@/lib/workspaces/policy'

export const POST = defineInternalJsonRoute({
  contract: recordWorkspaceVisitContract,
  auth: internalSessionAuth,
  operation: workspaceVisitOperations.record,
  rateLimit: internalRateLimits.none({
    reason: 'One idempotent upsert per workspace page load, replacing the settings write it made.',
  }),
  errorPolicy: extendInternalErrorPolicy(
    internalWorkspaceErrorPolicies.concealWorkspaceAuthorization,
    // A session that outlived its deleted account answers as signed out.
    (error) =>
      error instanceof WorkspaceOwnerMissingError
        ? internalErrorResponse(401, { error: 'Unauthorized' })
        : null
  ),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: recordWorkspaceVisit,
  present: () => ({ success: true as const }),
})
