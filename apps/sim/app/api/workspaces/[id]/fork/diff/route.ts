import { getForkDiffContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { getWorkspaceSyncDetails } from '@/ee/workspace-forking/application/sync-details'

export const GET = defineInternalJsonRoute({
  contract: getForkDiffContract,
  auth: internalSessionAuth,
  operation: forkOperations.syncPreview,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal fork request policy' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, ...query }),
  useCase: getWorkspaceSyncDetails,
  present: (result) => result,
})
