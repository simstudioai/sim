import { updateForkSyncDefaultContract } from '@/lib/api/contracts/workspace-fork'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'

export const PUT = defineInternalJsonRoute({
  contract: updateForkSyncDefaultContract,
  auth: internalSessionAuth,
  operation: forkOperations.syncDefault,
  /**
   * Rated, unlike its sibling fork routes. This is the one that writes workspaces the
   * caller may not administer, under the feature's coarsest advisory lock, so an admin of
   * any single lineage member could otherwise loop it and starve fork creation across the
   * whole lineage.
   */
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-fork-sync-default' }),
  errorPolicy: internalForkErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  present: ({ excludeNewWorkflows, workspacesUpdated }) => ({
    excludeNewWorkflows,
    workspacesUpdated,
  }),
  useCase: setForkSyncDefault,
})
