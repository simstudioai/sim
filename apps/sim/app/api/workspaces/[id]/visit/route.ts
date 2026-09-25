import { recordWorkspaceVisitContract } from '@/lib/api/contracts/workspaces'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalWorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import {
  recordWorkspaceVisit,
  workspaceVisitOperations,
} from '@/lib/workspaces/application/record-workspace-visit'

export const POST = defineInternalJsonRoute({
  contract: recordWorkspaceVisitContract,
  auth: internalSessionAuth,
  operation: workspaceVisitOperations.record,
  rateLimit: internalRateLimits.none({
    reason: 'One idempotent upsert per workspace page load, replacing the settings write it made.',
  }),
  errorPolicy: internalWorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: recordWorkspaceVisit,
  present: () => ({ success: true as const }),
})
